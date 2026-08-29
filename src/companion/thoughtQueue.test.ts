/**
 * The queue's pure half: where a thought goes, whether it is still worth saying, and what
 * the chip calls it.
 *
 * All three are arithmetic over a fold and a snapshot, so they are tested as arithmetic —
 * no editor, no clock, no network. The orchestrator owns the pump and the abort controllers;
 * nothing here knows they exist.
 */
import { describe, expect, it } from 'vitest'
import type { EpisodeSummary, SpatialEvent } from '@/domain'
import {
	describeGesture,
	insertByPriority,
	isStillTrue,
	pairKey,
	type EpisodeValidity,
	type Priority,
	type ThoughtState,
} from '@/companion/thoughtQueue'

const EMPTY: EpisodeValidity = {
	centers: {},
	influence: {},
	gravity: {},
	relationEnds: [],
	radius: {},
}

const summaryOf = (
	structural: SpatialEvent[] = [],
	pairs: EpisodeSummary['pairs'] = []
): EpisodeSummary => ({ structural, pairs })

const movedEvent = (
	nodeId: string,
	from: [number, number],
	to: [number, number]
): SpatialEvent => ({
	type: 'node_moved',
	nodeId,
	previous: { x: from[0], y: from[1] },
	current: { x: to[0], y: to[1] },
})

const pairChange = (source: string, target: string, before: number, after: number) => ({
	source,
	target,
	before: { influence: before },
	after: { influence: after },
	transitions: [],
})

describe('insertByPriority', () => {
	const item = (id: number, priority: Priority, state: ThoughtState = 'ready') => ({
		id,
		priority,
		state,
	})

	it('puts an ambient thought at the back', () => {
		const queue = [item(1, 'ambient'), item(2, 'ambient')]

		expect(insertByPriority(queue, item(3, 'ambient')).map((t) => t.id)).toEqual([1, 2, 3])
	})

	it('puts a direct request ahead of everything waiting', () => {
		const queue = [item(1, 'ambient'), item(2, 'ambient')]

		expect(insertByPriority(queue, item(9, 'direct')).map((t) => t.id)).toEqual([9, 1, 2])
	})

	it('never puts anything ahead of a remark already being spoken', () => {
		// Cutting a sentence off mid-word is the one thing the queue never does; a direct
		// request takes the next turn, not this one.
		const queue = [item(1, 'ambient', 'speaking'), item(2, 'ambient')]

		expect(insertByPriority(queue, item(9, 'direct')).map((t) => t.id)).toEqual([1, 9, 2])
	})

	it('keeps direct requests in the order they were asked for', () => {
		const queue = [item(1, 'direct'), item(2, 'ambient')]

		expect(insertByPriority(queue, item(9, 'direct')).map((t) => t.id)).toEqual([1, 9, 2])
	})
})

describe('isStillTrue — nothing to check', () => {
	it('keeps an episode whose claims it cannot speak to', () => {
		// A remark about the board as a whole leaves no trace in the episode, so there is
		// nothing here to contradict. Silence is cheap; a false drop is not.
		expect(isStillTrue(summaryOf(), EMPTY)).toBe(true)
	})
})

describe('isStillTrue — the subject exists', () => {
	it('drops an episode whose every idea has gone', () => {
		const summary = summaryOf(
			[movedEvent('a', [0, 0], [100, 100])],
			[pairChange('a', 'b', 0.04, 0.58)]
		)

		expect(isStillTrue(summary, EMPTY)).toBe(false)
	})

	it('keeps an episode where only one of its ideas has gone', () => {
		// Two of three still standing: the remark is partly about something that is still
		// there, which is more interesting than it is wrong.
		const summary = summaryOf([], [pairChange('a', 'b', 0.04, 0.58)])
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 } },
			influence: { [pairKey('a', 'b')]: 0.58 },
		}

		expect(isStillTrue(summary, validity)).toBe(true)
	})

	it('does not count a node the episode itself deleted as missing', () => {
		// "You removed that idea" is still true precisely because the idea is gone.
		const summary = summaryOf([{ type: 'node_deleted', nodeId: 'a' }])

		expect(isStillTrue(summary, EMPTY)).toBe(true)
	})

	it('drops an episode whose new idea has been undone', () => {
		const summary = summaryOf([{ type: 'node_created', nodeId: 'a' }])

		expect(isStillTrue(summary, EMPTY)).toBe(false)
	})

	it('drops an episode whose deletion was undone', () => {
		const summary = summaryOf([{ type: 'node_deleted', nodeId: 'a' }])
		const validity: EpisodeValidity = { ...EMPTY, centers: { a: { x: 0, y: 0 } } }

		expect(isStillTrue(summary, validity)).toBe(false)
	})
})

describe('isStillTrue — the move stands', () => {
	it('keeps a move the note has stayed put after', () => {
		const summary = summaryOf([movedEvent('a', [0, 0], [100, 0])])
		const validity: EpisodeValidity = { ...EMPTY, centers: { a: { x: 98, y: 0 } } }

		expect(isStillTrue(summary, validity)).toBe(true)
	})

	it('drops a move that has been dragged back', () => {
		const summary = summaryOf([movedEvent('a', [0, 0], [100, 0])])
		const validity: EpisodeValidity = { ...EMPTY, centers: { a: { x: 10, y: 0 } } }

		expect(isStillTrue(summary, validity)).toBe(false)
	})

	it('keeps a move the note has carried on past', () => {
		// Further in the same direction is the gesture continuing, not reversing.
		const summary = summaryOf([movedEvent('a', [0, 0], [100, 0])])
		const validity: EpisodeValidity = { ...EMPTY, centers: { a: { x: 300, y: 0 } } }

		expect(isStillTrue(summary, validity)).toBe(true)
	})
})

describe('isStillTrue — the proximity claim stands', () => {
	it('keeps a rise the ideas have held', () => {
		const summary = summaryOf([], [pairChange('a', 'b', 0.04, 0.58)])
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
			influence: { [pairKey('a', 'b')]: 0.55 },
		}

		expect(isStillTrue(summary, validity)).toBe(true)
	})

	it('drops a rise that has fallen back', () => {
		const summary = summaryOf([], [pairChange('a', 'b', 0.04, 0.58)])
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
			influence: { [pairKey('a', 'b')]: 0.1 },
		}

		expect(isStillTrue(summary, validity)).toBe(false)
	})

	it('drops a fall that has climbed back', () => {
		// The test is direction-free: closer to where it was than to where it went.
		const summary = summaryOf([], [pairChange('a', 'b', 0.58, 0.04)])
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
			influence: { [pairKey('a', 'b')]: 0.52 },
		}

		expect(isStillTrue(summary, validity)).toBe(false)
	})
})

describe('isStillTrue — the explicit relation stands', () => {
	const created = (relationId: string, source: string, target: string): SpatialEvent => ({
		type: 'relation_created',
		relationId,
		source,
		target,
		gravity: 1,
	})

	it('keeps an arrow that is still drawn', () => {
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
			gravity: { r1: 1 },
			relationEnds: [{ source: 'a', target: 'b' }],
		}

		expect(isStillTrue(summaryOf([created('r1', 'a', 'b')]), validity)).toBe(true)
	})

	it('drops an arrow that has been undrawn', () => {
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
		}

		expect(isStillTrue(summaryOf([created('r1', 'a', 'b')]), validity)).toBe(false)
	})

	it('drops a removal the user has drawn back', () => {
		const deleted: SpatialEvent = {
			type: 'relation_deleted',
			relationId: 'r1',
			source: 'a',
			target: 'b',
			gravity: 1,
		}
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
			relationEnds: [{ source: 'a', target: 'b' }],
		}

		expect(isStillTrue(summaryOf([deleted]), validity)).toBe(false)
	})

	it('keeps a removal that has stayed removed', () => {
		const deleted: SpatialEvent = {
			type: 'relation_deleted',
			relationId: 'r1',
			source: 'a',
			target: 'b',
			gravity: 1,
		}
		const validity: EpisodeValidity = {
			...EMPTY,
			centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
		}

		expect(isStillTrue(summaryOf([deleted]), validity)).toBe(true)
	})
})

describe('describeGesture', () => {
	const labels = { a: 'Pricing is the blocker', b: 'SSO' }

	it('names the note a move was about', () => {
		expect(
			describeGesture(summaryOf([movedEvent('a', [0, 0], [1, 1])]), { labels, relations: [] })
		).toBe('moved “Pricing is the…”')
	})

	it('counts the notes when several moved', () => {
		const summary = summaryOf([movedEvent('a', [0, 0], [1, 1]), movedEvent('b', [0, 0], [1, 1])])

		expect(describeGesture(summary, { labels, relations: [] })).toBe('moved 2 notes')
	})

	it('falls back to a count when the note has no text', () => {
		expect(
			describeGesture(summaryOf([movedEvent('a', [0, 0], [1, 1])]), { labels: {}, relations: [] })
		).toBe('moved 1 note')
	})

	it('names an arrow ahead of the moves around it', () => {
		// A relation is always the more interesting half of an episode, so it wins the label.
		const summary = summaryOf([
			movedEvent('a', [0, 0], [1, 1]),
			{ type: 'relation_created', relationId: 'r1', source: 'a', target: 'b', gravity: 1 },
		])

		expect(describeGesture(summary, { labels, relations: [] })).toBe(
			'linked “Pricing is the…” → “SSO”'
		)
	})

	it('names a new idea', () => {
		expect(
			describeGesture(summaryOf([{ type: 'node_created', nodeId: 'b' }]), { labels, relations: [] })
		).toBe('added “SSO”')
	})

	it('describes a pair-only episode by what shifted', () => {
		const summary = summaryOf([], [pairChange('a', 'b', 0.04, 0.58)])

		expect(describeGesture(summary, { labels, relations: [] })).toBe('“Pricing is the…” and “SSO”')
	})

	it('always says something', () => {
		expect(describeGesture(summaryOf(), { labels: {}, relations: [] })).toBe('a change')
	})
})
