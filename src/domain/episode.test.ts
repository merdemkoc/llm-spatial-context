/**
 * The episode layer: turning a raw stream of spatial events into the discrete
 * "interaction episode" the AI observer reasons about.
 *
 * `buildEpisodeSummary` folds a buffer of events into a compact before→after per
 * pair; `isTrivialEpisode` is the cheap local gate that keeps genuinely-nothing
 * episodes off the wire; `createEpisodeRecorder` buffers a live stream and finalizes
 * an episode after a pause. Pure, no tldraw, no network — the timer is injected.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SpatialEvent } from '@/domain/events'
import { createEventStream } from '@/domain/eventStream'
import {
	buildEpisodeSummary,
	createEpisodeRecorder,
	EPISODE_IDLE_MS,
	isTrivialEpisode,
	type Schedule,
} from '@/domain/episode'

const influence = (
	source: string,
	target: string,
	before: number,
	after: number
): SpatialEvent => ({
	type: 'influence_changed',
	source,
	target,
	previous: { influence: before },
	current: { influence: after },
})

const fieldExited = (source: string, target: string, before: number): SpatialEvent => ({
	type: 'field_exited',
	source,
	target,
	previous: { influence: before },
	current: { influence: 0 },
})

const moved = (nodeId: string): SpatialEvent => ({
	type: 'node_moved',
	nodeId,
	previous: { x: 0, y: 0 },
	current: { x: 10, y: 10 },
})

const movedTo = (
	nodeId: string,
	previous: { x: number; y: number },
	current: { x: number; y: number }
): SpatialEvent => ({ type: 'node_moved', nodeId, previous, current })

const relationCreated = (relationId: string, source: string, target: string): SpatialEvent => ({
	type: 'relation_created',
	relationId,
	source,
	target,
	gravity: 1,
})

describe('buildEpisodeSummary — folding pairs', () => {
	it('folds a pair to the first event before and the last event after', () => {
		const summary = buildEpisodeSummary([
			influence('a', 'b', 0.1, 0.3),
			influence('a', 'b', 0.3, 0.58),
		])

		expect(summary.pairs).toEqual([
			{
				source: 'a',
				target: 'b',
				before: { influence: 0.1 },
				after: { influence: 0.58 },
				transitions: ['influence_changed'],
			},
		])
	})

	it('keeps directed pairs separate', () => {
		const summary = buildEpisodeSummary([
			influence('a', 'b', 0.1, 0.5),
			influence('b', 'a', 0.2, 0.6),
		])

		expect(summary.pairs).toHaveLength(2)
	})

	it('collects structural events in order', () => {
		const summary = buildEpisodeSummary([relationCreated('r1', 'a', 'b'), moved('a')])

		expect(summary.structural.map((e) => e.type)).toEqual(['relation_created', 'node_moved'])
	})

	// A `NodeId` is only required to be a string, so one can contain a space. These two
	// pairs are distinct but collide under any printable separator — the same reason
	// `canvasDiff` and `effectiveStrength` key on `\u0000`.
	it('keeps pairs distinct when a node id contains a space', () => {
		const summary = buildEpisodeSummary([
			influence('a b', 'c', 0.1, 0.5),
			influence('a', 'b c', 0.2, 0.6),
		])

		expect(summary.pairs).toHaveLength(2)
	})

	// The adapter diffs on every store change, so a drag emits a `node_moved` per node per
	// tick — hundreds of them. Unfolded they dominate the payload and bury the pair deltas
	// that carry the actual signal.
	it('folds repeated moves of one node into a single net move', () => {
		const summary = buildEpisodeSummary([
			movedTo('a', { x: 0, y: 0 }, { x: 10, y: 0 }),
			movedTo('a', { x: 10, y: 0 }, { x: 20, y: 0 }),
			movedTo('a', { x: 20, y: 0 }, { x: 30, y: 0 }),
		])

		expect(summary.structural).toEqual([
			{ type: 'node_moved', nodeId: 'a', previous: { x: 0, y: 0 }, current: { x: 30, y: 0 } },
		])
	})

	it('folds each moved node separately, in first-seen order', () => {
		const summary = buildEpisodeSummary([
			movedTo('a', { x: 0, y: 0 }, { x: 1, y: 0 }),
			movedTo('b', { x: 5, y: 5 }, { x: 6, y: 5 }),
			movedTo('a', { x: 1, y: 0 }, { x: 2, y: 0 }),
		])

		expect(summary.structural).toHaveLength(2)
		expect(summary.structural.map((event) => ('nodeId' in event ? event.nodeId : ''))).toEqual([
			'a',
			'b',
		])
	})

	// The domain already classifies each transition — `field_entered`, `proximity_changed`
	// with a level. Dropping that leaves the model re-deriving it from two floats.
	it('records the transitions a pair went through', () => {
		const summary = buildEpisodeSummary([
			{
				type: 'field_entered',
				source: 'a',
				target: 'b',
				previous: { influence: 0 },
				current: { influence: 0.4 },
			},
			{
				type: 'proximity_changed',
				source: 'a',
				target: 'b',
				level: 'strong',
				previous: { influence: 0.4 },
				current: { influence: 0.8 },
			},
		])

		expect(summary.pairs[0].transitions).toEqual(['field_entered', 'proximity_changed:strong'])
	})
})

describe('isTrivialEpisode — the local gate', () => {
	it('treats an empty episode as trivial', () => {
		expect(isTrivialEpisode(buildEpisodeSummary([]))).toBe(true)
	})

	it('treats a tiny nudge with no structural change as trivial (MVP-2 Example 5)', () => {
		const summary = buildEpisodeSummary([moved('a'), influence('a', 'b', 0.36, 0.39)])

		expect(isTrivialEpisode(summary)).toBe(true)
	})

	it('treats a large proximity change as meaningful (MVP-2 Example 1)', () => {
		const summary = buildEpisodeSummary([moved('a'), influence('a', 'b', 0.04, 0.58)])

		expect(isTrivialEpisode(summary)).toBe(false)
	})

	it('treats creating an explicit relation as meaningful (MVP-2 Example 3)', () => {
		const summary = buildEpisodeSummary([relationCreated('r1', 'a', 'b')])

		expect(isTrivialEpisode(summary)).toBe(false)
	})

	it('treats spatial/explicit divergence as meaningful (MVP-2 Example 4)', () => {
		const summary = buildEpisodeSummary([
			relationCreated('r1', 'a', 'b'),
			moved('a'),
			fieldExited('a', 'b', 0.7),
		])

		expect(isTrivialEpisode(summary)).toBe(false)
	})
})

describe('createEpisodeRecorder', () => {
	function controllableSchedule() {
		let pending: (() => void) | null = null
		let lastMs = 0
		const schedule: Schedule = (fn, ms) => {
			pending = fn
			lastMs = ms
			return () => {
				if (pending === fn) pending = null
			}
		}
		return {
			schedule,
			flush: () => {
				const fn = pending
				pending = null
				fn?.()
			},
			get lastMs() {
				return lastMs
			},
			get hasPending() {
				return pending !== null
			},
		}
	}

	it('finalizes a buffered episode after the idle pause', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const onEpisode = vi.fn()
		createEpisodeRecorder(stream, { onEpisode, schedule: timer.schedule })

		stream.emit([influence('a', 'b', 0.04, 0.58)])
		expect(onEpisode).not.toHaveBeenCalled()
		expect(timer.lastMs).toBe(EPISODE_IDLE_MS)

		timer.flush()

		expect(onEpisode).toHaveBeenCalledTimes(1)
		expect(onEpisode.mock.calls[0][0].pairs).toEqual([
			{
				source: 'a',
				target: 'b',
				before: { influence: 0.04 },
				after: { influence: 0.58 },
				transitions: ['influence_changed'],
			},
		])
	})

	it('groups events that arrive before the pause into one episode', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const onEpisode = vi.fn()
		createEpisodeRecorder(stream, { onEpisode, schedule: timer.schedule })

		stream.emit([moved('a')])
		stream.emit([influence('a', 'b', 0.1, 0.5)])
		timer.flush()

		expect(onEpisode).toHaveBeenCalledTimes(1)
		expect(onEpisode.mock.calls[0][0].structural).toHaveLength(1)
		expect(onEpisode.mock.calls[0][0].pairs).toHaveLength(1)
	})

	it('starts a fresh episode after one is finalized', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const onEpisode = vi.fn()
		createEpisodeRecorder(stream, { onEpisode, schedule: timer.schedule })

		stream.emit([influence('a', 'b', 0.1, 0.5)])
		timer.flush()
		stream.emit([influence('c', 'd', 0.2, 0.6)])
		timer.flush()

		expect(onEpisode).toHaveBeenCalledTimes(2)
		expect(onEpisode.mock.calls[1][0].pairs[0].source).toBe('c')
	})

	it('stops finalizing after dispose', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const onEpisode = vi.fn()
		const dispose = createEpisodeRecorder(stream, { onEpisode, schedule: timer.schedule })

		dispose()
		stream.emit([influence('a', 'b', 0.1, 0.5)])

		expect(timer.hasPending).toBe(false)
	})
})
