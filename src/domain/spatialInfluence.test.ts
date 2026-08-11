/**
 * The core mathematics of the contextual field.
 *
 * Nodes are built with explicit coordinates so every distance in here is
 * verifiable by hand: post-its are 240×160 by default, so two nodes sharing a
 * `y` and separated by `Δx` in `x` are exactly `Δx` apart, centre to centre.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type PostItNode } from '@/domain/node'
import {
	buildSpatialContext,
	calculateSpatialInfluence,
	calculateSpatialInfluences,
	distanceBetweenNodes,
	nodeCenter,
} from '@/domain/spatialInfluence'

const NOW = '2026-08-09T12:00:00.000Z'

interface NodeOptions {
	id: string
	x?: number
	y?: number
	radius?: number
	rotation?: number
	text?: string
}

function node({ id, x = 0, y = 0, radius, rotation, text }: NodeOptions): PostItNode {
	return createPostItNode({ id, x, y, radius, rotation, text, now: NOW })
}

/** Two nodes `distance` apart on the x axis, the source having `radius`. */
function pair(distance: number, radius?: number): [PostItNode, PostItNode] {
	return [node({ id: 'source', x: 0, radius }), node({ id: 'target', x: distance })]
}

describe('nodeCenter', () => {
	it('is the box midpoint when unrotated', () => {
		expect(nodeCenter(node({ id: 'a', x: 300, y: 200 }))).toEqual({ x: 420, y: 280 })
	})

	it('rotates about the top-left corner, not the centre', () => {
		// SpatialProperties.rotation matches tldraw: the origin is (x, y). A
		// quarter turn therefore sends the centre offset (120, 80) to (-80, 120),
		// which `x + width / 2` would get badly wrong.
		const center = nodeCenter(node({ id: 'a', x: 300, y: 200, rotation: Math.PI / 2 }))

		expect(center.x).toBeCloseTo(220)
		expect(center.y).toBeCloseTo(320)
	})

	it('moves the centre when only rotation changes', () => {
		const upright = node({ id: 'source', x: 0 })
		const turned = node({ id: 'source', x: 0, rotation: Math.PI / 2 })
		const target = node({ id: 'target', x: 500 })

		expect(distanceBetweenNodes(turned, target)).not.toBeCloseTo(
			distanceBetweenNodes(upright, target)
		)
	})
})

describe('distanceBetweenNodes', () => {
	it('measures centre to centre', () => {
		expect(distanceBetweenNodes(...pair(250))).toBeCloseTo(250)
	})

	it('is Euclidean across both axes', () => {
		const source = node({ id: 'source', x: 0, y: 0 })
		const target = node({ id: 'target', x: 300, y: 400 })

		expect(distanceBetweenNodes(source, target)).toBeCloseTo(500)
	})

	it('is symmetric, unlike influence', () => {
		const [source, target] = pair(250, 500)

		expect(distanceBetweenNodes(source, target)).toBeCloseTo(distanceBetweenNodes(target, source))
	})
})

describe('calculateSpatialInfluence', () => {
	it('is 1 at the same position', () => {
		const source = node({ id: 'source', x: 300, y: 200, radius: 500 })
		const target = node({ id: 'target', x: 300, y: 200 })

		expect(calculateSpatialInfluence(source, target)).toBeCloseTo(1)
	})

	it('is 0.5 at half the radius', () => {
		expect(calculateSpatialInfluence(...pair(250, 500))).toBeCloseTo(0.5)
	})

	it('falls off linearly', () => {
		expect(calculateSpatialInfluence(...pair(125, 500))).toBeCloseTo(0.75)
		expect(calculateSpatialInfluence(...pair(375, 500))).toBeCloseTo(0.25)
	})

	it('is 0 exactly at the radius', () => {
		expect(calculateSpatialInfluence(...pair(500, 500))).toBeCloseTo(0)
	})

	it('is 0 outside the radius, never negative', () => {
		expect(calculateSpatialInfluence(...pair(600, 500))).toBe(0)
		expect(calculateSpatialInfluence(...pair(50_000, 500))).toBe(0)
	})

	it('is directional when radii differ', () => {
		// The point of the whole exercise: no semantic relation is involved, and
		// A → B still differs from B → A.
		const a = node({ id: 'a', x: 0, radius: 500 })
		const b = node({ id: 'b', x: 100, radius: 200 })

		expect(calculateSpatialInfluence(a, b)).toBeCloseTo(0.8)
		expect(calculateSpatialInfluence(b, a)).toBeCloseTo(0.5)
	})

	it('is 0 for a node on itself', () => {
		const a = node({ id: 'a', radius: 500 })

		expect(calculateSpatialInfluence(a, a)).toBe(0)
	})

	it('is 0 when the source has no field, at any distance', () => {
		expect(calculateSpatialInfluence(...pair(0))).toBe(0)
		expect(calculateSpatialInfluence(...pair(10))).toBe(0)
	})

	it('ignores the target’s field', () => {
		// Only the source's radius decides reach; a target with a huge field does
		// not pull influence towards itself.
		const source = node({ id: 'source', x: 0, radius: 500 })
		const target = node({ id: 'target', x: 250, radius: 100_000 })

		expect(calculateSpatialInfluence(source, target)).toBeCloseTo(0.5)
	})

	it('is 0 for a non-positive radius, without throwing', () => {
		expect(calculateSpatialInfluence(...pair(100, 0))).toBe(0)
		expect(calculateSpatialInfluence(...pair(100, -500))).toBe(0)
	})

	it('is 0 for a non-finite radius', () => {
		// NaN fails every comparison, so a bare `radius <= 0` guard would let it
		// through and return NaN from a function contracted to return 0–1.
		expect(calculateSpatialInfluence(...pair(100, Number.NaN))).toBe(0)
		expect(calculateSpatialInfluence(...pair(100, Number.POSITIVE_INFINITY))).toBe(0)
	})

	it('never leaves the 0–1 range', () => {
		for (const distance of [0, 1, 249, 250, 499, 500, 501, 10_000]) {
			const influence = calculateSpatialInfluence(...pair(distance, 500))

			expect(influence).toBeGreaterThanOrEqual(0)
			expect(influence).toBeLessThanOrEqual(1)
		}
	})
})

describe('calculateSpatialInfluences', () => {
	const a = node({ id: 'a', x: 0, radius: 500 })
	const b = node({ id: 'b', x: 100, radius: 200 })
	const c = node({ id: 'c', x: 400 })

	it('returns every directed pair and no self pairs', () => {
		const result = calculateSpatialInfluences([a, b, c])

		// N² − N.
		expect(result).toHaveLength(6)
		expect(result.map((row) => `${row.source}${row.target}`)).toEqual([
			'ab',
			'ac',
			'ba',
			'bc',
			'ca',
			'cb',
		])
	})

	it('reports asymmetric influence for the same pair', () => {
		const result = calculateSpatialInfluences([a, b])

		expect(result[0]).toMatchObject({ source: 'a', target: 'b' })
		expect(result[0].influence).toBeCloseTo(0.8)
		expect(result[1]).toMatchObject({ source: 'b', target: 'a' })
		expect(result[1].influence).toBeCloseTo(0.5)
	})

	it('keeps zero-influence rows, with a real distance on them', () => {
		// c has no field, so it influences nothing — but "out of range" and "we
		// didn't look" have to stay distinguishable.
		const rows = calculateSpatialInfluences([a, b, c]).filter((row) => row.source === 'c')

		expect(rows).toHaveLength(2)
		expect(rows.every((row) => row.influence === 0)).toBe(true)
		expect(rows.map((row) => Math.round(row.distance))).toEqual([400, 300])
	})

	it('handles empty and single-node canvases', () => {
		expect(calculateSpatialInfluences([])).toEqual([])
		expect(calculateSpatialInfluences([a])).toEqual([])
	})

	it('derives without mutating: the nodes are untouched', () => {
		// Influence must never be written back into the canonical model.
		const nodes = [a, b, c]
		const before = JSON.parse(JSON.stringify(nodes))

		calculateSpatialInfluences(nodes)

		expect(JSON.parse(JSON.stringify(nodes))).toEqual(before)
		expect(JSON.stringify(nodes)).not.toContain('influence')
	})
})

describe('buildSpatialContext', () => {
	const a = node({ id: 'a', x: 0, radius: 500 })
	const b = node({ id: 'b', x: 100, radius: 200 })
	const c = node({ id: 'c', x: 400 })

	it('wraps the influences in a spatialContext, and keeps every pair', () => {
		const context = buildSpatialContext([a, b, c])

		expect(Object.keys(context)).toEqual(['influences', 'effectiveStrengths'])
		expect(context.influences).toHaveLength(6)
	})

	it('is an empty list, not a missing key, for an empty canvas', () => {
		// A reader needs to see "nothing influences anything" rather than have to
		// infer it from an absent field.
		expect(buildSpatialContext([])).toEqual({ influences: [], effectiveStrengths: [] })
		expect(buildSpatialContext([a])).toEqual({ influences: [], effectiveStrengths: [] })
	})

	it('leaves effectiveStrengths empty when no relations are passed', () => {
		// Proximity alone never produces a combined row: with no arrow there is no
		// intent to combine, and inventing a gravity of 0 for every close pair would
		// be exactly the inference the model refuses to make.
		expect(buildSpatialContext([a, b, c]).effectiveStrengths).toEqual([])
	})

	it('uses source/target, the names the canonical JSON promises', () => {
		expect(Object.keys(buildSpatialContext([a, b]).influences[0]).sort()).toEqual([
			'distance',
			'influence',
			'source',
			'target',
		])
	})

	it('rounds distance to whole units and influence to three decimals', () => {
		// 300/400/500 is the exact triangle; nudge it so rounding is observable.
		const near = node({ id: 'near', x: 0, radius: 700 })
		const far = node({ id: 'far', x: 301, y: 400 })

		const [entry] = buildSpatialContext([near, far]).influences

		expect(entry.distance).toBe(Math.round(distanceBetweenNodes(near, far)))
		expect(Number.isInteger(entry.distance)).toBe(true)
		expect(entry.influence).toBe(Math.round(calculateSpatialInfluence(near, far) * 1000) / 1000)
		expect(String(entry.influence).replace(/^[^.]*\.?/, '').length).toBeLessThanOrEqual(3)
	})

	it('leaves the exact values alone — rounding is the document, not the maths', () => {
		const source = node({ id: 'source', x: 0, radius: 700 })
		const target = node({ id: 'target', x: 301, y: 400 })

		const exact = calculateSpatialInfluences([source, target])[0]
		const rounded = buildSpatialContext([source, target]).influences[0]

		expect(Number.isInteger(exact.distance)).toBe(false)
		expect(rounded.distance).not.toBe(exact.distance)
	})

	it('is deterministic', () => {
		expect(buildSpatialContext([a, b, c])).toEqual(buildSpatialContext([a, b, c]))
	})

	it('writes nothing back into the nodes', () => {
		const nodes = [a, b, c]
		const before = JSON.parse(JSON.stringify(nodes))

		buildSpatialContext(nodes)

		expect(JSON.parse(JSON.stringify(nodes))).toEqual(before)
	})

	it('infers no semantic relation from proximity', () => {
		// The distinction the whole model rests on: proximity produces a number,
		// never a named relationship.
		const json = JSON.stringify(buildSpatialContext([a, b, c]))

		expect(json).not.toContain('type')
		expect(json).not.toContain('related')
	})
})

describe('createPostItNode', () => {
	it('omits contextualField entirely when no radius is given', () => {
		// No implicit default: a node with no field is not a node with a big one.
		expect(node({ id: 'a' })).not.toHaveProperty('contextualField')
		expect(JSON.stringify(node({ id: 'a' }))).not.toContain('contextualField')
	})

	it('sets the radius it was given, including zero', () => {
		expect(node({ id: 'a', radius: 500 }).contextualField).toEqual({ radius: 500 })
		expect(node({ id: 'a', radius: 0 }).contextualField).toEqual({ radius: 0 })
	})
})
