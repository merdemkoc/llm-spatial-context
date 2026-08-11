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
import { createPostItNode, nodeCenter, type Point, type PostItNode } from '@/domain'
import {
	groundingProjection,
	imageScale,
	nodeCorners,
	nodeImageAabb,
	nodeImageQuad,
	relationImageAabb,
	relationImagePoint,
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

/**
 * These once asserted that a badge sits at the midpoint of the two nodes' centres,
 * which was the bug: a curved arrow never passes through that point. The badge
 * position is now measured from the drawn path by the adapter and passed in, so
 * what this function owns is only the world → image conversion.
 */
describe('relationImagePoint', () => {
	const projection = { minX: 0, minY: 0, width: 1000, height: 1000 }

	function geometry(midpoint: Point, bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }) {
		return { relationId: 'r1', bounds, midpoint }
	}

	it('is the supplied point on the path, in image pixels', () => {
		expect(relationImagePoint(geometry({ x: 300, y: 200 }), projection, 2)).toEqual({
			x: 600,
			y: 400,
		})
	})

	it('does not care where the nodes are', () => {
		// The whole point of the change: two arrows between the same pair of notes can
		// bow in different directions, and each badge follows its own curve.
		const up = relationImagePoint(geometry({ x: 300, y: 20 }), projection, 1)
		const down = relationImagePoint(geometry({ x: 300, y: 580 }), projection, 1)

		expect(up).not.toEqual(down)
	})

	it('places it where the projection and scale say, not in world units', () => {
		expect(
			relationImagePoint(
				geometry({ x: 250, y: 150 }),
				{ minX: 100, minY: 100, width: 400, height: 400 },
				3
			)
		).toEqual({ x: 450, y: 150 })
	})
})

describe('relationImageAabb', () => {
	const projection = { minX: 0, minY: 0, width: 1000, height: 1000 }

	it('is the drawn path’s box, so a bowed arrow’s overhang is in it', () => {
		const bowed = {
			relationId: 'r1',
			bounds: { minX: 100, minY: 80, maxX: 900, maxY: 600 },
			midpoint: { x: 500, y: 600 },
		}

		expect(relationImageAabb(bowed, projection, 2)).toEqual([200, 160, 1800, 1200])
	})

	it('is relative to the projection’s origin', () => {
		const arrow = {
			relationId: 'r1',
			bounds: { minX: 150, minY: 150, maxX: 250, maxY: 350 },
			midpoint: { x: 200, y: 250 },
		}

		expect(relationImageAabb(arrow, { minX: 100, minY: 100, width: 400, height: 400 }, 1)).toEqual([
			50, 50, 150, 250,
		])
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
	 * Regression. These are the numbers off a real canvas: 1101.42578125 ×
	 * 497.99609375 floors to 2202 × 995, implying scales of 1.99923 and 1.99800.
	 *
	 * The flooring error each axis contributes is up to a whole pixel, so the
	 * *difference between the two scales* is bounded by `1 / min(width, height)` —
	 * which means any budget expressed against the longest edge is really a budget
	 * of one aspect ratio. A fixed pixel budget rejected this 2.2:1 canvas while
	 * happily accepting a square one.
	 */
	it('accepts a wide image whose two axes floored differently', () => {
		const wide = { minX: 0, minY: 0, width: 1101.42578125, height: 497.99609375 }

		expect(imageScale(wide, { width: 2202, height: 995 })).toBeCloseTo(1.9992, 3)
	})

	it('accepts a tall image whose two axes floored differently', () => {
		const tall = { minX: 0, minY: 0, width: 497.99609375, height: 1101.42578125 }

		expect(imageScale(tall, { width: 995, height: 2202 })).toBeCloseTo(1.998, 3)
	})

	/**
	 * A misaligned box is worse than no box: it would confidently point at the
	 * wrong pixels. If the image isn't the rectangle that was asked for — trimmed
	 * or clamped — there is no scale that makes the boxes correct.
	 */
	it('refuses an image whose aspect ratio is not the projection’s', () => {
		expect(() => imageScale(projection, { width: 1440, height: 540 })).toThrow(
			/not the rectangle that was requested/i
		)
	})

	/** Uniform clamping keeps the aspect, so it is a smaller scale, not an error. */
	it('accepts an image the browser clamped down on both axes', () => {
		expect(imageScale(projection, { width: 720, height: 540 })).toBe(1)
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

describe('nodeImageAabb', () => {
	it('is the node’s scaled rect in image space when it is not rotated', () => {
		const unrotated = node({ x: 100, y: 100 })
		const projection = groundingProjection([unrotated], 20)

		expect(nodeImageAabb(unrotated, projection, 2)).toEqual([40, 40, 520, 360])
	})

	/**
	 * Four numbers cannot express a rotation, so for a rotated node the bbox is
	 * the axis-aligned box *containing* it — looser than the outline drawn on the
	 * image, which follows the rotation. Here the whole projection is exactly the
	 * rotated node's extent, so the bbox is the whole image.
	 */
	it('contains the whole rotated node', () => {
		const rotated = node({ width: 240, height: 160, rotation: Math.PI / 6 })
		const projection = groundingProjection([rotated], 0)

		const [x1, y1, x2, y2] = nodeImageAabb(rotated, projection, 2)

		expect([x1, y1]).toEqual([0, 0])
		expect(x2).toBeCloseTo(projection.width * 2)
		expect(y2).toBeCloseTo(projection.height * 2)
	})

	it('never reports a reversed box', () => {
		const rotated = node({ rotation: (Math.PI * 5) / 4 })
		const projection = groundingProjection([rotated], 10)

		const [x1, y1, x2, y2] = nodeImageAabb(rotated, projection, 2)

		expect(x2).toBeGreaterThan(x1)
		expect(y2).toBeGreaterThan(y1)
	})

	/**
	 * The bbox in the JSON and the outline in the image describe the same node, so
	 * the one must contain the other. Pins them to each other rather than to two
	 * separately-derived expectations.
	 */
	it('bounds every corner of the drawn outline', () => {
		const rotated = node({ x: 220, y: -60, rotation: 0.9 })
		const projection = groundingProjection([rotated, node({ id: 'b', x: -400, y: 300 })], 40)
		const scale = 2.5

		const [x1, y1, x2, y2] = nodeImageAabb(rotated, projection, scale)

		for (const corner of nodeImageQuad(rotated, projection, scale)) {
			expect(corner.x).toBeGreaterThanOrEqual(x1)
			expect(corner.x).toBeLessThanOrEqual(x2)
			expect(corner.y).toBeGreaterThanOrEqual(y1)
			expect(corner.y).toBeLessThanOrEqual(y2)
		}
	})
})
