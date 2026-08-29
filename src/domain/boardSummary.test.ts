/**
 * The whole-board summary: the compact reading of the current arrangement that
 * feeds both the observer's ambient remarks and the grouping suggester.
 *
 * Nodes are built with explicit coordinates so every influence is verifiable by
 * hand: post-its are 240×160, so two nodes sharing a `y` and separated by `Δx`
 * are exactly `Δx` apart, centre to centre, and influence is `1 − Δx/radius`.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type PostItNode } from '@/domain/node'
import type { CanvasDocument, Relation, RelationId } from '@/domain/canvas'
import { buildSpatialContext } from '@/domain/spatialInfluence'
import { BOARD_NODE_LIMIT, buildBoardSummary } from '@/domain/boardSummary'

const NOW = '2026-08-28T12:00:00.000Z'

interface NodeOptions {
	id: string
	x?: number
	y?: number
	radius?: number
	text?: string
}

function node({ id, x = 0, y = 0, radius, text }: NodeOptions): PostItNode {
	return createPostItNode({ id, x, y, radius, text, now: NOW })
}

type RelationInput = Partial<Relation> & { from: string; to: string }

function doc(nodes: PostItNode[], relationList: RelationInput[] = []): CanvasDocument {
	const nodeRecord: CanvasDocument['nodes'] = {}
	for (const entry of nodes) nodeRecord[entry.id] = entry

	const relations: Record<RelationId, Relation> = {}
	relationList.forEach((entry, index) => {
		const id = entry.id ?? `r${index + 1}`
		relations[id] = { id, gravity: entry.gravity ?? 1, from: entry.from, to: entry.to, type: entry.type }
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

describe('buildBoardSummary', () => {
	it('counts nodes and carries their text and field presence', () => {
		const summary = buildBoardSummary(
			doc([node({ id: 'a', text: 'alpha', radius: 500 }), node({ id: 'b', x: 3000, text: 'beta' })])
		)

		expect(summary.nodeCount).toBe(2)
		expect(summary.nodes).toEqual([
			{ id: 'a', text: 'alpha', hasField: true },
			{ id: 'b', text: 'beta', hasField: false },
		])
		expect(summary.truncated).toBe(false)
	})

	it('groups strongly-proximate nodes into a cluster and leaves the distant one out', () => {
		// a and b are 100 apart with radius 500 → influence 0.8 (≥ 0.66, a cluster edge).
		// c is 2000 away → influence 0, so it joins nothing.
		const summary = buildBoardSummary(
			doc([
				node({ id: 'a', x: 0, radius: 500 }),
				node({ id: 'b', x: 100, radius: 500 }),
				node({ id: 'c', x: 2000, radius: 500 }),
			])
		)

		expect(summary.clusters).toEqual([{ members: ['a', 'b'] }])
	})

	it('lists a node in no cluster and no relation as a loner', () => {
		const summary = buildBoardSummary(
			doc([
				node({ id: 'a', x: 0, radius: 500 }),
				node({ id: 'b', x: 100, radius: 500 }),
				node({ id: 'c', x: 2000, radius: 500 }),
			])
		)

		expect(summary.loners).toEqual(['c'])
	})

	it('does not count a node touched by a relation as a loner, however far it sits', () => {
		const summary = buildBoardSummary(
			doc(
				[node({ id: 'a', x: 0, radius: 500 }), node({ id: 'c', x: 2000, radius: 500 })],
				[{ from: 'a', to: 'c' }]
			)
		)

		expect(summary.loners).toEqual([])
	})

	it('reports notable closeness as undirected pairs above the weak threshold, deduped', () => {
		// a↔b influence 0.8 (kept); d is 600 away from a and 500 from b, both out of
		// range at radius 500, so it contributes no proximity.
		const summary = buildBoardSummary(
			doc([
				node({ id: 'a', x: 0, radius: 500 }),
				node({ id: 'b', x: 100, radius: 500 }),
				node({ id: 'd', x: 600, radius: 500 }),
			])
		)

		expect(summary.proximities).toEqual([{ source: 'a', target: 'b', influence: 0.8 }])
	})

	it('projects explicit relations with gravity and label', () => {
		const summary = buildBoardSummary(
			doc(
				[node({ id: 'a' }), node({ id: 'b', x: 300 })],
				[{ from: 'a', to: 'b', gravity: 0.5, type: 'supports' }]
			)
		)

		expect(summary.relations).toEqual([{ source: 'a', target: 'b', gravity: 0.5, type: 'supports' }])
	})

	it('is empty and untruncated for an empty board', () => {
		const summary = buildBoardSummary(doc([]))

		expect(summary).toEqual({
			nodeCount: 0,
			nodes: [],
			clusters: [],
			loners: [],
			proximities: [],
			relations: [],
			effectiveStrengths: [],
			truncated: false,
		})
	})

	it('caps the node list and flags truncation past the limit', () => {
		const many = Array.from({ length: BOARD_NODE_LIMIT + 5 }, (_, i) =>
			node({ id: `n${String(i).padStart(3, '0')}`, x: i * 3000 })
		)
		const summary = buildBoardSummary(doc(many))

		expect(summary.nodeCount).toBe(BOARD_NODE_LIMIT + 5)
		expect(summary.nodes).toHaveLength(BOARD_NODE_LIMIT)
		expect(summary.truncated).toBe(true)
	})
})
