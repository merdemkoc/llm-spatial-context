/**
 * The three defects a curved relation arrow exposed in the grounded export.
 *
 * Reproduced from a real artifact: two post-its connected by arrows that bow well
 * outside the notes' own bounding box. The export clipped the arrows, and placed
 * each gravity badge at the midpoint of the two node *centres* — a point the curve
 * never passes through, which in that export landed on an unrelated node's label
 * and read as that node's gravity.
 *
 * Written before the fix, so each `it` here fails for the reason it names.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type PostItNode, type RelationGeometry } from '@/domain'
import {
	groundingProjection,
	relationImageAabb,
	relationImagePoint,
} from '@/canvas/grounding/projection'
import { assignRelationVisualIds } from '@/canvas/grounding/visualId'
import { buildGrounding, relationAnnotations } from '@/canvas/grounding/grounding'
import { assignVisualIds } from '@/canvas/grounding/visualId'

const NOW = '2026-08-11T12:00:00.000Z'

function node(id: string, x: number, y: number): PostItNode {
	return createPostItNode({ id, x, y, now: NOW })
}

/**
 * An arrow that bows 400 units *below* both of its endpoints — the shape of the
 * one in the reported export. Its bounds therefore extend past the nodes'.
 */
function bowedArrow(relationId: string): RelationGeometry {
	return {
		relationId,
		bounds: { minX: 100, minY: 80, maxX: 900, maxY: 600 },
		midpoint: { x: 500, y: 600 },
	}
}

describe('export bounds', () => {
	it('holds an arrow that bows outside the nodes, so nothing is clipped', () => {
		// Two nodes on one row: their own bounds stop at y = 160.
		const nodes = [node('a', 0, 0), node('b', 800, 0)]
		const projection = groundingProjection(nodes, 0, [bowedArrow('r1')])

		// The arrow reaches y = 600. Without it in the union the box stopped at 160
		// and the curve was cut off the bottom of the PNG.
		expect(projection.minY + projection.height).toBeGreaterThanOrEqual(600)
	})

	it('still fits the nodes when an arrow is entirely inside them', () => {
		const nodes = [node('a', 0, 0), node('b', 800, 0)]
		const inside: RelationGeometry = {
			relationId: 'r1',
			bounds: { minX: 300, minY: 60, maxX: 500, maxY: 100 },
			midpoint: { x: 400, y: 80 },
		}

		expect(groundingProjection(nodes, 0, [inside])).toEqual(groundingProjection(nodes, 0, []))
	})

	it('is unchanged from the node-only projection when there are no relations', () => {
		const nodes = [node('a', 0, 0), node('b', 800, 0)]

		expect(groundingProjection(nodes, 40, [])).toEqual(groundingProjection(nodes, 40))
	})
})

describe('badge placement', () => {
	const nodes = [node('a', 0, 0), node('b', 800, 0)]
	const projection = groundingProjection(nodes, 0, [bowedArrow('r1')])

	it('is the point on the drawn path, not the midpoint of the node centres', () => {
		const at = relationImagePoint(bowedArrow('r1'), projection, 1)

		// The supplied on-curve point is (500, 600). The midpoint of the two node
		// centres is (520, 80) — 520 units away, and in the reported export that is
		// what put a badge on an unrelated node's label.
		expect(at).toEqual({ x: 500 - projection.minX, y: 600 - projection.minY })
	})

	it('gives each arrow its own bbox in image pixels', () => {
		const bbox = relationImageAabb(bowedArrow('r1'), projection, 1)

		expect(bbox).toEqual([
			100 - projection.minX,
			80 - projection.minY,
			900 - projection.minX,
			600 - projection.minY,
		])
	})
})

describe('relation visual ids', () => {
	it('numbers arrows R1, R2… in reading order of their badge points', () => {
		const lower: RelationGeometry = {
			relationId: 'r-lower',
			bounds: { minX: 0, minY: 400, maxX: 100, maxY: 500 },
			midpoint: { x: 50, y: 450 },
		}
		const upper: RelationGeometry = {
			relationId: 'r-upper',
			bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
			midpoint: { x: 50, y: 50 },
		}

		expect(assignRelationVisualIds([lower, upper]).map((entry) => entry.visualId)).toEqual([
			'R1',
			'R2',
		])
		// R1 is the upper one, following the nodes' own reading order.
		expect(assignRelationVisualIds([lower, upper])[0].geometry.relationId).toBe('r-upper')
	})
})

describe('grounding.relations', () => {
	const nodes = [node('a', 0, 0), node('b', 800, 0)]

	it('indexes every arrow, so the picture is joinable to the JSON', () => {
		const geometry = [bowedArrow('r1')]
		const projection = groundingProjection(nodes, 0, geometry)

		const grounding = buildGrounding(
			assignVisualIds(nodes),
			projection,
			{ width: Math.round(projection.width), height: Math.round(projection.height) },
			assignRelationVisualIds(geometry)
		)

		expect(grounding.relations.R1).toMatchObject({ relationId: 'r1' })
		expect(grounding.relations.R1.bbox).toHaveLength(4)
		expect(grounding.relations.R1.badge).toHaveLength(2)
	})
})

describe('badge labels', () => {
	it('names the arrow, so two relations at the same gravity are distinguishable', () => {
		// The reported export had two badges both reading `g 1.00` with nothing to
		// tell them apart, and neither near its own arrow.
		const geometry = [bowedArrow('r1'), bowedArrow('r2')]
		const projection = groundingProjection([node('a', 0, 0)], 0, geometry)

		const annotations = relationAnnotations(
			{
				r1: { id: 'r1', from: 'a', to: 'b', gravity: 1 },
				r2: { id: 'r2', from: 'a', to: 'b', gravity: 1 },
			},
			assignRelationVisualIds(geometry),
			projection,
			1
		)

		expect(annotations.map((entry) => entry.label)).toEqual(['R1 g 1.00', 'R2 g 1.00'])
	})
})
