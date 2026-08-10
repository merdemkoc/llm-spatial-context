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
 * The largest misalignment, in image pixels, tolerated between the two axes.
 *
 * Expressed as a pixel budget rather than a bare epsilon because that is the
 * thing anyone cares about: a whole pixel of drift across the longest edge of
 * the image is invisible, and anything more means the image is not the rectangle
 * that was requested.
 */
const SCALE_TOLERANCE_PX = 1

/**
 * Pixels per world unit, measured from the decoded image.
 *
 * Deliberately not the `scale` that was requested. tldraw multiplies by `scale`,
 * then by `pixelRatio` (2 by default), then floors, then clamps to the browser's
 * maximum canvas size — so the requested number is not the number that came out.
 * Measuring absorbs all four.
 *
 * Throws rather than guessing when the image doesn't match the projection. A
 * misaligned box is worse than no box: it points confidently at the wrong node.
 */
export function imageScale(
	projection: GroundingProjection,
	image: { width: number; height: number }
): number {
	if (projection.width <= 0 || projection.height <= 0) {
		throw new Error('Cannot ground an image over a projection with no area')
	}

	const horizontal = image.width / projection.width
	const vertical = image.height / projection.height

	const drift = Math.abs(horizontal - vertical) * Math.max(projection.width, projection.height)
	if (drift > SCALE_TOLERANCE_PX) {
		throw new Error(
			`Exported image is ${image.width}×${image.height}px, which is not the requested ` +
				`bounds of ${projection.width}×${projection.height} world units at any single scale`
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

/** The node's outline in image pixels, clockwise from the top-left. */
export function nodeImageQuad(
	node: CanvasNode,
	projection: GroundingProjection,
	scale: number
): Point[] {
	return nodeCorners(node).map((corner) => toImagePoint(corner, projection, scale))
}
