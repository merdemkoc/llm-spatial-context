/**
 * Where a Node is, in the pixels of an exported image.
 *
 * Two coordinate systems meet here and only here. World coordinates are what
 * the canonical model speaks (`spatial.x/y/width/height`); image coordinates are
 * pixels from the top-left of the PNG. Everything else in the grounding module
 * works in one or the other and never converts.
 *
 * The scale is deliberately *not* stored in a projection. tldraw's export
 * applies `scale`, then `pixelRatio`, then floors, then clamps to the browser's
 * maximum canvas size, so the only trustworthy pixels-per-world-unit is the one
 * measured from the decoded image. It is passed in per call.
 */
import type { CanvasNode, Point } from '@/domain'
import { nodeCenter } from '@/domain'

/** The world-space rectangle an exported image covers. */
export interface GroundingProjection {
	minX: number
	minY: number
	width: number
	height: number
}

/**
 * The node's four corners in world space, clockwise from the top-left.
 *
 * `SpatialProperties.rotation` is applied about the unrotated box's top-left
 * corner rather than its centre, matching the renderer. The same convention
 * lives in `nodeCenter` (`src/domain/spatialInfluence.ts`); a test pins the two
 * together by asserting this quad's centroid is that centre, because a silent
 * divergence here draws every box beside its node instead of around it.
 */
export function nodeCorners(node: CanvasNode): Point[] {
	const { x, y, width, height, rotation } = node.spatial

	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)

	return [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	].map(([dx, dy]) => ({
		x: x + dx * cos - dy * sin,
		y: y + dx * sin + dy * cos,
	}))
}

/**
 * The world rectangle to export, sized to hold every node.
 *
 * Unions the *rotated* corners rather than the `x/y/width/height` boxes.
 * Rotation sweeps a node outside its unrotated box, so unioning the boxes would
 * clip a rotated node at the edge of the canvas — and grounding a node that
 * isn't in the image is worse than not grounding it.
 */
export function groundingProjection(nodes: CanvasNode[], padding: number): GroundingProjection {
	// `Math.min` of nothing is `Infinity`. An empty canvas has no meaningful
	// bounds, and an empty box says so; infinite ones would travel a long way
	// into an export before failing.
	if (nodes.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 }

	const corners = nodes.flatMap(nodeCorners)
	const xs = corners.map((corner) => corner.x)
	const ys = corners.map((corner) => corner.y)

	const minX = Math.min(...xs) - padding
	const minY = Math.min(...ys) - padding

	return {
		minX,
		minY,
		width: Math.max(...xs) + padding - minX,
		height: Math.max(...ys) + padding - minY,
	}
}

/**
 * Pixels per world unit, measured from the decoded image.
 *
 * Deliberately not the `scale` that was requested. tldraw multiplies by `scale`,
 * then by `pixelRatio` (2 by default), then floors, then clamps to the browser's
 * maximum canvas size — so the requested number is not the number that came out.
 * Measuring absorbs all four.
 *
 * Throws rather than guessing when the image isn't the rectangle that was asked
 * for — trimmed, or clamped on one axis only. A misaligned box is worse than no
 * box: it points confidently at the wrong node.
 *
 * The check is "does the height follow from the width", in pixels, rather than
 * "do the two implied scales agree". The two axes are floored independently, so
 * the scales *never* quite agree, and the size of that disagreement grows with
 * the aspect ratio — comparing them against a fixed budget rejects a wide canvas
 * for being wide.
 */
export function imageScale(
	projection: GroundingProjection,
	image: { width: number; height: number }
): number {
	if (projection.width <= 0 || projection.height <= 0) {
		throw new Error('Cannot ground an image over a projection with no area')
	}

	const horizontal = image.width / projection.width

	// Flooring costs each axis up to a whole pixel. On the height that is 1px
	// directly; the width's own lost pixel arrives here multiplied by the aspect
	// ratio, since it shifts the scale the height is predicted from.
	const slack = 1 + projection.height / projection.width
	const expectedHeight = projection.height * horizontal

	if (Math.abs(image.height - expectedHeight) > slack) {
		throw new Error(
			`Exported image is ${image.width}×${image.height}px, but ${image.width}px wide over ` +
				`${projection.width} world units implies a height of ${Math.round(expectedHeight)}px, ` +
				`not ${image.height}px — the image is not the rectangle that was requested`
		)
	}

	return horizontal
}

/** World point → image pixel. */
export function toImagePoint(point: Point, projection: GroundingProjection, scale: number): Point {
	return {
		x: (point.x - projection.minX) * scale,
		y: (point.y - projection.minY) * scale,
	}
}

/**
 * Where a relation between two nodes reads, in image pixels: the midpoint of
 * their centres.
 *
 * Derived from the two nodes rather than measured from the arrow shape, which
 * keeps this pure and keeps the position **re-derivable by a reader** — the same
 * midpoint follows from `nodes[].spatial` and `grounding` alone, so a badge on the
 * PNG can be checked against the JSON instead of trusted.
 *
 * The cost is a bent or elbow arrow, whose curve leaves the straight line between
 * the centres: the badge stays at the midpoint and the arrow doesn't pass through
 * it. Following the drawn curve would mean reading tldraw's arrow geometry, which
 * this layer deliberately can't see.
 */
export function relationImagePoint(
	from: CanvasNode,
	to: CanvasNode,
	projection: GroundingProjection,
	scale: number
): Point {
	const start = nodeCenter(from)
	const end = nodeCenter(to)

	return toImagePoint({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, projection, scale)
}

/** The node's outline in image pixels, clockwise from the top-left. */
export function nodeImageQuad(
	node: CanvasNode,
	projection: GroundingProjection,
	scale: number
): Point[] {
	return nodeCorners(node).map((corner) => toImagePoint(corner, projection, scale))
}

/**
 * `[x1, y1, x2, y2]` in image pixels — the top-left and bottom-right of the
 * node's axis-aligned bounding box.
 *
 * Corners rather than `[x, y, width, height]`, and the difference matters to
 * anyone reading the JSON: the last two numbers are absolute positions in the
 * image, not extents.
 *
 * For a rotated node this is *looser* than the outline drawn on the image, which
 * follows the rotation. Four numbers can't express a rotation, so the bbox is the
 * smallest axis-aligned box containing the node; a test pins it to the drawn
 * quad's corners so the two can't disagree about which node they describe.
 */
export function nodeImageAabb(
	node: CanvasNode,
	projection: GroundingProjection,
	scale: number
): [number, number, number, number] {
	const quad = nodeImageQuad(node, projection, scale)
	const xs = quad.map((corner) => corner.x)
	const ys = quad.map((corner) => corner.y)

	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
