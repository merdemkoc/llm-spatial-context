/**
 * Turning a diff into a stream of events.
 *
 * `deriveEvents` is fed a real `CanvasDiff` — produced by `diffCanvas` over two
 * documents assembled through `buildSpatialContext`, the same way `canvasDiff.test.ts`
 * works — so the events it emits are derived from the genuine before/after numbers a
 * reader would see, not from hand-written fixtures.
 *
 * Post-its are 240x160, so two nodes sharing a `y` and separated by `Dx` in `x` are
 * exactly `Dx` apart, centre to centre. With a radius of 500, influence `a→b` is
 * `1 − Dx/500`: at 600 it is 0 (out of field), 300 → 0.4, 250 → 0.5, 100 → 0.8.
 */
import { describe, expect, it } from 'vitest'
import type { CanvasDocument, Relation, RelationId } from '@/domain/canvas'
import { createPostItNode, type PostItNode } from '@/domain/node'
import { buildSpatialContext } from '@/domain/spatialInfluence'
import { diffCanvas } from '@/domain/canvasDiff'
import { deriveEvents, type SpatialEvent } from '@/domain/events'

const NOW = '2026-08-11T12:00:00.000Z'

interface NodeOptions {
	id: string
	x?: number
	y?: number
	radius?: number
}

function node({ id, x = 0, y = 0, radius }: NodeOptions): PostItNode {
	return createPostItNode({ id, x, y, radius, now: NOW })
}

type RelationInput = Partial<Relation> & { from: string; to: string }

function doc(nodes: PostItNode[], relationList: RelationInput[] = []): CanvasDocument {
	const nodeRecord: CanvasDocument['nodes'] = {}
	for (const entry of nodes) nodeRecord[entry.id] = entry

	const relations: Record<RelationId, Relation> = {}
	relationList.forEach((entry, index) => {
		const id = entry.id ?? `r${index + 1}`
		relations[id] = { id, gravity: entry.gravity ?? 1, from: entry.from, to: entry.to }
	})

	return {
		id: 'canvas',
		nodes: nodeRecord,
		relations,
		spatialContext: buildSpatialContext(nodes, relations),
		grounding: { image: { width: 1, height: 1 }, nodes: {}, relations: {} },
		metadata: { createdAt: NOW, updatedAt: NOW },
	}
}

/** The events of one type, so a test can assert on what it is about. */
function ofType<T extends SpatialEvent['type']>(
	events: SpatialEvent[],
	type: T
): Array<Extract<SpatialEvent, { type: T }>> {
	return events.filter((event): event is Extract<SpatialEvent, { type: T }> => event.type === type)
}

function events(before: CanvasDocument, after: CanvasDocument): SpatialEvent[] {
	return deriveEvents(diffCanvas(before, after))
}

describe('deriveEvents — nothing to report', () => {
	it('emits no events for a document compared with itself', () => {
		const canvas = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])

		expect(deriveEvents(diffCanvas(canvas, canvas))).toEqual([])
	})
})

describe('deriveEvents — structural events', () => {
	it('emits node_created for a created node', () => {
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a' }), node({ id: 'b', x: 300 })])

		expect(ofType(events(before, after), 'node_created')).toEqual([
			{ type: 'node_created', nodeId: 'b' },
		])
	})

	it('emits node_deleted for a deleted node', () => {
		const before = doc([node({ id: 'a' }), node({ id: 'b', x: 300 })])
		const after = doc([node({ id: 'a' })])

		expect(ofType(events(before, after), 'node_deleted')).toEqual([
			{ type: 'node_deleted', nodeId: 'b' },
		])
	})

	it('emits node_moved carrying the centre before and after', () => {
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a', x: 100, y: 50 })])

		expect(ofType(events(before, after), 'node_moved')).toEqual([
			{ type: 'node_moved', nodeId: 'a', previous: { x: 120, y: 80 }, current: { x: 220, y: 130 } },
		])
	})

	it('emits relation_created with endpoints and gravity', () => {
		const nodes = [node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })]

		expect(
			ofType(events(doc(nodes), doc(nodes, [{ id: 'r1', from: 'a', to: 'b' }])), 'relation_created')
		).toEqual([
			{ type: 'relation_created', relationId: 'r1', source: 'a', target: 'b', gravity: 1 },
		])
	})

	it('emits relation_deleted with endpoints and gravity', () => {
		const nodes = [node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })]

		expect(
			ofType(events(doc(nodes, [{ id: 'r1', from: 'a', to: 'b' }]), doc(nodes)), 'relation_deleted')
		).toEqual([
			{ type: 'relation_deleted', relationId: 'r1', source: 'a', target: 'b', gravity: 1 },
		])
	})

	it('emits contextual_field_changed, omitting the side that was absent', () => {
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a', radius: 300 })])

		const [event] = ofType(events(before, after), 'contextual_field_changed')

		expect(event).toEqual({ type: 'contextual_field_changed', nodeId: 'a', current: 300 })
		expect('previous' in event).toBe(false)
	})
})

describe('deriveEvents — field crossings', () => {
	it('emits field_entered when influence rises from zero, with both snapshots', () => {
		// b starts out of a's 500 field (600 away → influence 0), then moves inside (300 → 0.4).
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 600 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])

		expect(ofType(events(before, after), 'field_entered')).toEqual([
			{
				type: 'field_entered',
				source: 'a',
				target: 'b',
				previous: { distance: 600, influence: 0 },
				current: { distance: 300, influence: 0.4 },
			},
		])
	})

	it('emits field_exited when influence falls to zero', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 600 })])

		expect(ofType(events(before, after), 'field_exited')).toEqual([
			{
				type: 'field_exited',
				source: 'a',
				target: 'b',
				previous: { distance: 300, influence: 0.4 },
				current: { distance: 600, influence: 0 },
			},
		])
	})

	it('does not emit a field crossing for the pairs a newly created node forms', () => {
		// A node created already inside a field never *crossed* the boundary; its
		// membership is reported by node_created, not by a spurious field_entered.
		const before = doc([node({ id: 'a', radius: 500 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])

		expect(ofType(events(before, after), 'field_entered')).toEqual([])
	})
})

describe('deriveEvents — influence changes within a field', () => {
	it('emits influence_changed when both sides are inside the field', () => {
		// 0.4 → 0.5, both between the weak and strong thresholds, so this is the only
		// spatial event: no boundary crossed, no proximity band changed.
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 250 })])

		expect(ofType(events(before, after), 'influence_changed')).toEqual([
			{
				type: 'influence_changed',
				source: 'a',
				target: 'b',
				previous: { distance: 300, influence: 0.4 },
				current: { distance: 250, influence: 0.5 },
			},
		])
	})

	it('does not emit influence_changed on a field crossing (that is field_entered/exited)', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 600 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])

		expect(ofType(events(before, after), 'influence_changed')).toEqual([])
	})
})

describe('deriveEvents — proximity bands', () => {
	it('emits proximity_changed { strong } when influence crosses up over the strong threshold', () => {
		// 0.5 → 0.8 crosses 0.66. Influence also changed, so both events fire.
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 250 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })])

		const proximity = ofType(events(before, after), 'proximity_changed')

		expect(proximity).toHaveLength(1)
		expect(proximity[0]).toMatchObject({ source: 'a', target: 'b', level: 'strong' })
	})

	it('emits proximity_changed { weak } when influence drops under the weak threshold but stays in field', () => {
		// 0.5 → 0.2 crosses 0.33 downward while remaining above 0, so the pair is now
		// weakly proximate rather than out of the field entirely.
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 250 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })])

		const proximity = ofType(events(before, after), 'proximity_changed')

		expect(proximity).toHaveLength(1)
		expect(proximity[0]).toMatchObject({ source: 'a', target: 'b', level: 'weak' })
	})

	it('does not emit a weak crossing on a full field exit', () => {
		// Influence to 0 is field_exited, not a weak-band crossing.
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 250 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 600 })])

		expect(ofType(events(before, after), 'proximity_changed')).toEqual([])
	})
})

describe('deriveEvents — the divergence scenario', () => {
	it('keeps the relation while the field is exited when a connected node is dragged far away', () => {
		// MVP 1 §8 Step 6: distance high, influence gone, relation intact. The stream
		// reports the field exit; the relation is untouched, so it produces no event.
		const relation = [{ id: 'r1', from: 'a', to: 'b' }]
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })], relation)
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 900 })], relation)

		const stream = events(before, after)

		expect(ofType(stream, 'field_exited')).toHaveLength(1)
		expect(ofType(stream, 'relation_deleted')).toEqual([])
	})
})

describe('deriveEvents — ordering', () => {
	it('emits structural events before spatial ones', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 600 })])
		const after = doc(
			[node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })],
			[{ id: 'r1', from: 'a', to: 'b' }]
		)

		const types = events(before, after).map((event) => event.type)
		const lastStructural = types.lastIndexOf('relation_created')
		const firstSpatial = types.indexOf('field_entered')

		expect(lastStructural).toBeLessThan(firstSpatial)
	})
})
