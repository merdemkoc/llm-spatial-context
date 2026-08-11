/**
 * Comparing two canvases.
 *
 * Documents are assembled through `buildSpatialContext`, so the derived layers a
 * diff reads are the real ones rather than fixtures — a test that hand-wrote its
 * own influences could not catch a diff disagreeing with the document it
 * describes.
 *
 * Post-its are 240x160, so two nodes sharing a `y` and separated by `Dx` in `x`
 * are exactly `Dx` apart, centre to centre.
 */
import { describe, expect, it } from 'vitest'
import type { CanvasDocument, Relation, RelationId } from '@/domain/canvas'
import { createPostItNode, type PostItNode } from '@/domain/node'
import { buildSpatialContext } from '@/domain/spatialInfluence'
import { diffCanvas, type CanvasChange } from '@/domain/canvasDiff'

const NOW = '2026-08-11T12:00:00.000Z'

interface NodeOptions {
	id: string
	x?: number
	y?: number
	width?: number
	height?: number
	radius?: number
	rotation?: number
}

function node({ id, x = 0, y = 0, width, height, radius, rotation }: NodeOptions): PostItNode {
	return createPostItNode({ id, x, y, width, height, radius, rotation, now: NOW })
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

/** The changes of one kind, so a test can assert on what it is about. */
function ofKind<K extends CanvasChange['kind']>(
	diff: { changes: CanvasChange[] },
	kind: K
): Array<Extract<CanvasChange, { kind: K }>> {
	return diff.changes.filter(
		(change): change is Extract<CanvasChange, { kind: K }> => change.kind === kind
	)
}

function pair(diff: ReturnType<typeof diffCanvas>, source: string, target: string) {
	return diff.pairs.find((entry) => entry.source === source && entry.target === target)
}

describe('diffCanvas', () => {
	it('reports nothing for a document compared with itself', () => {
		const canvas = doc(
			[node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })],
			[{ from: 'a', to: 'b' }]
		)

		expect(diffCanvas(canvas, canvas)).toEqual({ changes: [], pairs: [] })
	})

	it('reports nothing for a change too small to appear in the document', () => {
		// The epsilon is the document's own rounding: distance to whole units and the
		// 0-1 signals to three decimals. A diff must never claim a change a reader
		// cannot see for themselves in the JSON.
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300.0001 })])

		expect(diffCanvas(before, after)).toEqual({ changes: [], pairs: [] })
	})
})

describe('node changes', () => {
	it('reports a created node', () => {
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a' }), node({ id: 'b', x: 300 })])

		expect(ofKind(diffCanvas(before, after), 'node_created')).toEqual([
			{ kind: 'node_created', node: 'b' },
		])
	})

	it('reports a deleted node', () => {
		const before = doc([node({ id: 'a' }), node({ id: 'b', x: 300 })])
		const after = doc([node({ id: 'a' })])

		expect(ofKind(diffCanvas(before, after), 'node_deleted')).toEqual([
			{ kind: 'node_deleted', node: 'b' },
		])
	})

	it('reports a move as centres, not corners', () => {
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a', x: 100, y: 50 })])

		expect(ofKind(diffCanvas(before, after), 'node_moved')).toEqual([
			{ kind: 'node_moved', node: 'a', before: { x: 120, y: 80 }, after: { x: 220, y: 130 } },
		])
	})

	it('reports a rotation as a move, because it moves the centre', () => {
		// `spatial.rotation` is applied about the unrotated box's top-left, so a
		// quarter turn sends the centre offset (120, 80) to (-80, 120) while
		// `spatial.x`/`y` never change. A diff comparing raw x/y would miss it, and
		// every distance in the document would have moved without explanation.
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a', rotation: Math.PI / 2 })])

		expect(ofKind(diffCanvas(before, after), 'node_moved')).toEqual([
			{ kind: 'node_moved', node: 'a', before: { x: 120, y: 80 }, after: { x: -80, y: 120 } },
		])
	})

	it('reports a resize as a move, for the same reason', () => {
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a', width: 400 })])

		expect(ofKind(diffCanvas(before, after), 'node_moved')).toEqual([
			{ kind: 'node_moved', node: 'a', before: { x: 120, y: 80 }, after: { x: 200, y: 80 } },
		])
	})
})

describe('contextual field changes', () => {
	it('reports a widened radius with both sides', () => {
		const before = doc([node({ id: 'a', radius: 200 })])
		const after = doc([node({ id: 'a', radius: 500 })])

		expect(ofKind(diffCanvas(before, after), 'contextual_field_changed')).toEqual([
			{ kind: 'contextual_field_changed', node: 'a', before: 200, after: 500 },
		])
	})

	it('omits `before` entirely when the node had no field', () => {
		// Absent is not zero. "Had no field" and "had a field of 0" are different
		// states, and inventing a `before: 0` would report the wrong one.
		const before = doc([node({ id: 'a' })])
		const after = doc([node({ id: 'a', radius: 300 })])

		const [change] = ofKind(diffCanvas(before, after), 'contextual_field_changed')

		expect(change).toEqual({ kind: 'contextual_field_changed', node: 'a', after: 300 })
		expect('before' in change).toBe(false)
	})

	it('omits `after` entirely when the field was cleared', () => {
		const before = doc([node({ id: 'a', radius: 300 })])
		const after = doc([node({ id: 'a' })])

		const [change] = ofKind(diffCanvas(before, after), 'contextual_field_changed')

		expect(change).toEqual({ kind: 'contextual_field_changed', node: 'a', before: 300 })
		expect('after' in change).toBe(false)
	})

	it('distinguishes a cleared field from one set to zero', () => {
		const cleared = diffCanvas(doc([node({ id: 'a', radius: 300 })]), doc([node({ id: 'a' })]))
		const zeroed = diffCanvas(
			doc([node({ id: 'a', radius: 300 })]),
			doc([node({ id: 'a', radius: 0 })])
		)

		expect(ofKind(cleared, 'contextual_field_changed')[0].after).toBeUndefined()
		expect(ofKind(zeroed, 'contextual_field_changed')[0].after).toBe(0)
	})
})

describe('relation changes', () => {
	const nodes = () => [
		node({ id: 'a', radius: 500 }),
		node({ id: 'b', x: 300 }),
		node({ id: 'c', x: 900 }),
	]

	it('reports a created relation with its endpoints and gravity', () => {
		const diff = diffCanvas(doc(nodes()), doc(nodes(), [{ id: 'r1', from: 'a', to: 'b' }]))

		expect(ofKind(diff, 'relation_created')).toEqual([
			{
				kind: 'relation_created',
				relation: 'r1',
				endpoints: { source: 'a', target: 'b' },
				gravity: 1,
			},
		])
	})

	it('reports a deleted relation', () => {
		const diff = diffCanvas(doc(nodes(), [{ id: 'r1', from: 'a', to: 'b' }]), doc(nodes()))

		expect(ofKind(diff, 'relation_deleted')).toEqual([
			{
				kind: 'relation_deleted',
				relation: 'r1',
				endpoints: { source: 'a', target: 'b' },
				gravity: 1,
			},
		])
	})

	it('reports a rebind as an update, not a delete plus a create', () => {
		// Only possible because RelationId derives from the arrow's shape id, which
		// survives dragging one end onto a different note.
		const diff = diffCanvas(
			doc(nodes(), [{ id: 'r1', from: 'a', to: 'b' }]),
			doc(nodes(), [{ id: 'r1', from: 'a', to: 'c' }])
		)

		expect(ofKind(diff, 'relation_rebound')).toEqual([
			{
				kind: 'relation_rebound',
				relation: 'r1',
				before: { source: 'a', target: 'b' },
				after: { source: 'a', target: 'c' },
			},
		])
		expect(ofKind(diff, 'relation_created')).toEqual([])
		expect(ofKind(diff, 'relation_deleted')).toEqual([])
	})

	it('reports a gravity change', () => {
		const diff = diffCanvas(
			doc(nodes(), [{ id: 'r1', from: 'a', to: 'b', gravity: 1 }]),
			doc(nodes(), [{ id: 'r1', from: 'a', to: 'b', gravity: 0.3 }])
		)

		expect(ofKind(diff, 'relation_gravity_changed')).toEqual([
			{ kind: 'relation_gravity_changed', relation: 'r1', before: 1, after: 0.3 },
		])
	})

	it('reports a rebind and a reweight separately when both happened', () => {
		// Two things the user did, so two changes. Collapsing them would lose one.
		const diff = diffCanvas(
			doc(nodes(), [{ id: 'r1', from: 'a', to: 'b', gravity: 1 }]),
			doc(nodes(), [{ id: 'r1', from: 'a', to: 'c', gravity: 0.5 }])
		)

		expect(ofKind(diff, 'relation_rebound')).toHaveLength(1)
		expect(ofKind(diff, 'relation_gravity_changed')).toHaveLength(1)
	})
})

describe('pair deltas', () => {
	it('reports distance and influence moving together when a node is dragged closer', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })])

		const forward = pair(diffCanvas(before, after), 'a', 'b')

		expect(forward?.distance).toEqual({ before: 400, after: 100, delta: -300 })
		expect(forward?.influence).toEqual({ before: 0.2, after: 0.8, delta: 0.6 })
	})

	it('omits gravity and effectiveStrength for a pair with no relation', () => {
		// Absent, not zero: the pair has no intent to report either side of.
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })])

		const forward = pair(diffCanvas(before, after), 'a', 'b')

		expect(forward && 'gravity' in forward).toBe(false)
		expect(forward && 'effectiveStrength' in forward).toBe(false)
	})

	it('introduces gravity with an `after` and no `before` when a relation is drawn', () => {
		const nodes = [node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })]
		const diff = diffCanvas(doc(nodes), doc(nodes, [{ from: 'a', to: 'b' }]))

		const forward = pair(diff, 'a', 'b')

		expect(forward?.gravity).toEqual({ after: 1 })
		// 0.2 x 0.25 + 1 x 0.75 = 0.8
		expect(forward?.effectiveStrength).toEqual({ after: 0.8 })
		// The layout did not move, so proximity reports nothing.
		expect(forward && 'distance' in forward).toBe(false)
		expect(forward && 'influence' in forward).toBe(false)
	})

	it('keeps gravity while influence falls when a connected node is dragged away', () => {
		// MVP 0's fourth example, as one diff: influence decreased, explicit gravity
		// remains. The two signals disagreeing is the information.
		const relation = [{ from: 'a', to: 'b' }]
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })], relation)
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 450 })], relation)

		const forward = pair(diffCanvas(before, after), 'a', 'b')

		expect(forward?.influence?.delta).toBeLessThan(0)
		expect(forward && 'gravity' in forward).toBe(false)
		expect(forward?.effectiveStrength?.delta).toBeLessThan(0)
	})

	it('removes gravity with a `before` and no `after` when a relation is deleted', () => {
		const nodes = [node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })]
		const diff = diffCanvas(doc(nodes, [{ from: 'a', to: 'b' }]), doc(nodes))

		expect(pair(diff, 'a', 'b')?.gravity).toEqual({ before: 1 })
		// And the spatial influence survives it untouched.
		expect(pair(diff, 'a', 'b') && 'influence' in pair(diff, 'a', 'b')!).toBe(false)
	})

	it('reports one-sided distances for the pairs a created node forms', () => {
		const before = doc([node({ id: 'a', radius: 500 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])

		const forward = pair(diffCanvas(before, after), 'a', 'b')

		expect(forward?.distance).toEqual({ after: 300 })
		expect(forward?.influence).toEqual({ after: 0.4 })
		expect(forward?.distance && 'before' in forward.distance).toBe(false)
	})

	it('reports one-sided distances for the pairs a deleted node leaves', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })])
		const after = doc([node({ id: 'a', radius: 500 })])

		expect(pair(diffCanvas(before, after), 'a', 'b')?.distance).toEqual({ before: 300 })
	})

	it('reports both directions of an affected pair', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400, radius: 500 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100, radius: 500 })])

		const diff = diffCanvas(before, after)

		expect(pair(diff, 'a', 'b')).toBeDefined()
		expect(pair(diff, 'b', 'a')).toBeDefined()
	})

	it('drops the pairs a move did not touch', () => {
		// A drag in a three-node canvas moves 4 of the 6 directed pairs; the pair
		// between the two stationary nodes is not one of them.
		const stationary = [node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300, radius: 500 })]
		const before = doc([...stationary, node({ id: 'c', x: 900, radius: 500 })])
		const after = doc([...stationary, node({ id: 'c', x: 950, radius: 500 })])

		const diff = diffCanvas(before, after)

		expect(pair(diff, 'a', 'b')).toBeUndefined()
		expect(pair(diff, 'b', 'a')).toBeUndefined()
		expect(diff.pairs).toHaveLength(4)
	})

	it('orders pairs by how much their 0-1 signals moved', () => {
		// `a` reaches both, so dragging it changes its influence on the near node more
		// than on the far one. Distance is deliberately not the ranking key.
		const before = doc([
			node({ id: 'a', radius: 1000 }),
			node({ id: 'b', x: 200 }),
			node({ id: 'c', x: 900 }),
		])
		const after = doc([
			node({ id: 'a', radius: 1000, x: 100 }),
			node({ id: 'b', x: 200 }),
			node({ id: 'c', x: 900 }),
		])

		const diff = diffCanvas(before, after)
		const magnitudes = diff.pairs.map((entry) => Math.abs(entry.influence?.delta ?? 0))

		expect(magnitudes).toEqual([...magnitudes].sort((x, y) => y - x))
	})
})

describe('ordering and robustness', () => {
	it('groups changes by kind, structure before geometry', () => {
		const before = doc([node({ id: 'b', x: 300, radius: 100 })])
		const after = doc(
			[node({ id: 'a', radius: 500 }), node({ id: 'b', x: 350, radius: 200 })],
			[{ id: 'r1', from: 'a', to: 'b' }]
		)

		expect(diffCanvas(before, after).changes.map((change) => change.kind)).toEqual([
			'node_created',
			'node_moved',
			'contextual_field_changed',
			'relation_created',
		])
	})

	it('is deterministic regardless of node insertion order', () => {
		const a = node({ id: 'a', radius: 500 })
		const b = node({ id: 'b', x: 300 })
		const c = node({ id: 'c', x: 600 })

		const before = doc([a, b, c])
		const forwards = doc([a, node({ id: 'b', x: 320 }), c])
		const backwards = doc([c, node({ id: 'b', x: 320 }), a])

		expect(diffCanvas(before, forwards)).toEqual(diffCanvas(before, backwards))
	})

	it('tolerates a document written before effectiveStrengths existed', () => {
		// Imported JSON is typed by assertion only. Treating a missing array as "no
		// combined rows" is what the document says; trusting the type would throw.
		const nodes = [node({ id: 'a', radius: 500 }), node({ id: 'b', x: 300 })]
		const legacy = doc(nodes)
		delete (legacy.spatialContext as { effectiveStrengths?: unknown }).effectiveStrengths

		const diff = diffCanvas(legacy, doc(nodes, [{ from: 'a', to: 'b' }]))

		expect(pair(diff, 'a', 'b')?.gravity).toEqual({ after: 1 })
	})

	it('is antisymmetric: swapping the arguments negates every delta', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })])

		const forward = pair(diffCanvas(before, after), 'a', 'b')
		const reverse = pair(diffCanvas(after, before), 'a', 'b')

		expect(reverse?.influence?.delta).toBeCloseTo(-(forward?.influence?.delta ?? 0), 10)
		expect(reverse?.distance?.delta).toBe(-(forward?.distance?.delta ?? 0))
	})

	it('does not mutate either document', () => {
		const before = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 400 })])
		const after = doc([node({ id: 'a', radius: 500 }), node({ id: 'b', x: 100 })])
		const snapshot = JSON.parse(JSON.stringify({ before, after }))

		diffCanvas(before, after)

		expect(JSON.parse(JSON.stringify({ before, after }))).toEqual(snapshot)
	})
})
