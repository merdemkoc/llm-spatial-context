/**
 * When the standing reading has gone stale.
 *
 * The weights encode a claim: meaning changes when content or explicit claims change, not
 * when pixels do. Dragging is the overwhelming majority of events and must score nothing,
 * or the companion re-reads the whole board every time the user tidies up.
 */
import { describe, expect, it } from 'vitest'
import { DRIFT_THRESHOLD, driftOf, driftWeight } from '@/domain/understandingDrift'
import type { SpatialEvent } from '@/domain/events'

const snapshot = { distance: 100, influence: 0.5 }

describe('driftWeight', () => {
	it('weighs new and lost content most heavily', () => {
		expect(driftWeight({ type: 'node_created', nodeId: 'a' })).toBe(3)
		expect(driftWeight({ type: 'node_deleted', nodeId: 'a' })).toBe(3)
	})

	it('weighs an explicit claim made or retracted', () => {
		expect(
			driftWeight({
				type: 'relation_created',
				relationId: 'r',
				source: 'a',
				target: 'b',
				gravity: 0.8,
			})
		).toBe(2)
		expect(
			driftWeight({
				type: 'relation_deleted',
				relationId: 'r',
				source: 'a',
				target: 'b',
				gravity: 0.8,
			})
		).toBe(2)
	})

	it('counts a cluster forming but not one loosening', () => {
		const base = { source: 'a', target: 'b', previous: snapshot, current: snapshot } as const
		expect(driftWeight({ type: 'proximity_changed', level: 'strong', ...base })).toBe(1)
		expect(driftWeight({ type: 'proximity_changed', level: 'weak', ...base })).toBe(0)
	})

	it('scores nothing for moving things around', () => {
		const moved: SpatialEvent = {
			type: 'node_moved',
			nodeId: 'a',
			previous: { x: 0, y: 0 },
			current: { x: 50, y: 50 },
		}
		expect(driftWeight(moved)).toBe(0)
	})

	it('scores nothing for re-weighting a claim already made', () => {
		expect(
			driftWeight({
				type: 'relation_gravity_changed',
				relationId: 'r',
				previous: 0.5,
				current: 0.9,
			})
		).toBe(0)
	})
})

describe('driftOf', () => {
	it('is zero for a drag storm, however long', () => {
		const drags: SpatialEvent[] = Array.from({ length: 200 }, (_, i) => ({
			type: 'node_moved',
			nodeId: `n${i}`,
			previous: { x: 0, y: 0 },
			current: { x: i, y: i },
		}))
		expect(driftOf(drags)).toBe(0)
	})

	it('crosses the threshold on two new notes', () => {
		const added: SpatialEvent[] = [
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'node_created', nodeId: 'b' },
		]
		expect(driftOf(added)).toBeGreaterThanOrEqual(DRIFT_THRESHOLD)
	})

	it('crosses the threshold on a note plus two arrows', () => {
		const mixed: SpatialEvent[] = [
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'relation_created', relationId: 'r1', source: 'a', target: 'b', gravity: 0.5 },
			{ type: 'relation_created', relationId: 'r2', source: 'a', target: 'c', gravity: 0.5 },
		]
		expect(driftOf(mixed)).toBeGreaterThanOrEqual(DRIFT_THRESHOLD)
	})

	it('stays under the threshold for a single new note', () => {
		expect(driftOf([{ type: 'node_created', nodeId: 'a' }])).toBeLessThan(DRIFT_THRESHOLD)
	})
})
