/**
 * The world → image mapping, which is the only thing standing between a
 * grounding box and the wrong node.
 *
 * A rotation of `π/2` is used throughout because its cos/sin are exactly 0 and
 * 1, so every expected corner is an integer and readable by hand. Rotation is
 * applied about the *top-left* corner, so a node at `(0, 0)` rotated `π/2`
 * sweeps into negative `x`.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, nodeCenter, type PostItNode } from '@/domain'
import {
	groundingProjection,
	imageScale,
	nodeCorners,
	nodeImageQuad,
	toImagePoint,
} from '@/canvas/grounding/projection'

const NOW = '2026-08-10T12:00:00.000Z'

interface NodeOptions {
	id?: string
	x?: number
	y?: number
	width?: number
	height?: number
	rotation?: number
}

function node({ id = 'a', x = 0, y = 0, width, height, rotation }: NodeOptions = {}): PostItNode {
	return createPostItNode({ id, x, y, width, height, rotation, now: NOW })
}

describe('nodeCorners', () => {
	it('returns the rect corners clockwise from the top left', () => {
		expect(nodeCorners(node({ x: 300, y: 200, width: 240, height: 160 }))).toEqual([
			{ x: 300, y: 200 },
			{ x: 540, y: 200 },
			{ x: 540, y: 360 },
			{ x: 300, y: 360 },
		])
	})

	it('rotates about the top-left corner', () => {
		const corners = nodeCorners(node({ width: 240, height: 160, rotation: Math.PI / 2 }))

		expect(corners.map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 240 },
			{ x: -160, y: 240 },
			{ x: -160, y: 0 },
		])
	})

	/**
	 * The rotation convention now lives in two places — here and `nodeCenter` in
	 * the domain. This pins them together mechanically, so a change to either
	 * one fails rather than quietly drawing boxes next to their nodes.
	 */
	it('has its centroid at the node centre', () => {
		const rotated = node({ x: 137, y: -42, rotation: 0.7 })
		const corners = nodeCorners(rotated)

		const centroid = {
			x: corners.reduce((total, corner) => total + corner.x, 0) / 4,
			y: corners.reduce((total, corner) => total + corner.y, 0) / 4,
		}

		expect(centroid.x).toBeCloseTo(nodeCenter(rotated).x)
		expect(centroid.y).toBeCloseTo(nodeCenter(rotated).y)
	})
})

describe('groundingProjection', () => {
	it('covers every node, expanded by the padding', () => {
		const nodes = [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 400, y: 300 })]

		expect(groundingProjection(nodes, 40)).toEqual({
			minX: -40,
			minY: -40,
			width: 720,
			height: 540,
		})
	})

	/**
	 * The unrotated box would report `width: 240, height: 160` starting at
	 * `(0, 0)`. The node isn't there — it swept left and down.
	 */
	it('covers where a rotated node actually is, not its unrotated box', () => {
		const rotated = node({ width: 240, height: 160, rotation: Math.PI / 2 })

		const projection = groundingProjection([rotated], 0)

		expect(projection.minX).toBeCloseTo(-160)
		expect(projection.minY).toBeCloseTo(0)
		expect(projection.width).toBeCloseTo(160)
		expect(projection.height).toBeCloseTo(240)
	})

	/** `Math.min` of nothing is `Infinity`, which would silently poison an export. */
	it('degrades to an empty box rather than infinite bounds', () => {
		expect(groundingProjection([], 40)).toEqual({ minX: 0, minY: 0, width: 0, height: 0 })
	})
})

describe('toImagePoint', () => {
	const projection = { minX: -40, minY: -40, width: 720, height: 540 }

	it('puts the projection origin at the image origin', () => {
		expect(toImagePoint({ x: -40, y: -40 }, projection, 2)).toEqual({ x: 0, y: 0 })
	})

	it('puts the far corner at the far corner of the image', () => {
		expect(toImagePoint({ x: 680, y: 500 }, projection, 2)).toEqual({ x: 1440, y: 1080 })
	})
})

describe('imageScale', () => {
	const projection = { minX: 0, minY: 0, width: 720, height: 540 }

	it('measures the scale from the decoded image rather than trusting the request', () => {
		expect(imageScale(projection, { width: 1440, height: 1080 })).toBe(2)
	})

	/** tldraw floors the pixel dimensions, so the two axes rarely agree exactly. */
	it('tolerates the sub-pixel disagreement flooring introduces', () => {
		const awkward = { minX: 0, minY: 0, width: 723.4, height: 541.2 }

		expect(imageScale(awkward, { width: 1446, height: 1082 })).toBeCloseTo(1.9989, 3)
	})

	/**
	 * A misaligned box is worse than no box: it would confidently point at the
	 * wrong pixels. If the image isn't the rectangle that was asked for — trimmed
	 * or clamped — there is no scale that makes the boxes correct.
	 */
	it('refuses an image whose aspect ratio is not the projection’s', () => {
		expect(() => imageScale(projection, { width: 1440, height: 540 })).toThrow(/bounds/i)
	})

	it('refuses a projection with no area', () => {
		expect(() =>
			imageScale({ minX: 0, minY: 0, width: 0, height: 0 }, { width: 1, height: 1 })
		).toThrow(/area/i)
	})
})

describe('nodeImageQuad', () => {
	it('projects an unrotated node to its scaled rect in image space', () => {
		const projection = groundingProjection([node({ x: 100, y: 100 })], 20)

		expect(nodeImageQuad(node({ x: 100, y: 100 }), projection, 2)).toEqual([
			{ x: 40, y: 40 },
			{ x: 520, y: 40 },
			{ x: 520, y: 360 },
			{ x: 40, y: 360 },
		])
	})

	it('keeps a rotated node inside the image it was projected into', () => {
		const rotated = node({ rotation: Math.PI / 2 })
		const projection = groundingProjection([rotated], 0)
		const scale = 3

		for (const corner of nodeImageQuad(rotated, projection, scale)) {
			expect(corner.x).toBeGreaterThanOrEqual(0)
			expect(corner.y).toBeGreaterThanOrEqual(0)
			expect(corner.x).toBeLessThanOrEqual(projection.width * scale)
			expect(corner.y).toBeLessThanOrEqual(projection.height * scale)
		}
	})
})
