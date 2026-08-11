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
import type { CanvasNode, Point, RelationGeometry } from '@/domain'

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
 * The world rectangle to export, sized to hold every node **and every arrow**.
 *
 * Unions the *rotated* corners rather than the `x/y/width/height` boxes.
 * Rotation sweeps a node outside its unrotated box, so unioning the boxes would
 * clip a rotated node at the edge of the canvas — and grounding a node that
 * isn't in the image is worse than not grounding it.
 *
 * Arrows are unioned in for exactly the same reason, and it is not a hypothetical:
 * a relation drawn as a curve bows outside the box its two endpoints span, so an
 * export sized to the nodes alone cut the overhang off the edge of the PNG while
 * still drawing the rest of the arrow. Half a visible arrow is a worse artifact
 * than a slightly larger image.
 *
 * `relations` is optional and last, so a caller with nothing to say about arrows
 * gets exactly the box this returned before arrows were considered.
 */
export function groundingProjection(
	nodes: CanvasNode[],
	padding: number,
	relations: RelationGeometry[] = []
): GroundingProjection {
	// `Math.min` of nothing is `Infinity`. An empty canvas has no meaningful
	// bounds, and an empty box says so; infinite ones would travel a long way
	// into an export before failing.
	//
	// Keyed on nodes, not on nodes-plus-arrows: an arrow with no node at either end
	// is not something this layer grounds, and sizing an export around one would
	// produce a picture of a line pointing at nothing.
	if (nodes.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 }

	const corners = nodes.flatMap(nodeCorners)
	const xs = corners.map((corner) => corner.x)
	const ys = corners.map((corner) => corner.y)

	for (const relation of relations) {
		xs.push(relation.bounds.minX, relation.bounds.maxX)
		ys.push(relation.bounds.minY, relation.bounds.maxY)
	}

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
 * Where a relation's badge goes, in image pixels: a point **on the drawn path**.
 *
 * This used to be synthesised — the midpoint of the two node centres — so that a
 * reader could recompute it from `nodes[].spatial` alone. That re-derivability was
 * real, and it was bought at a price that turned out to be too high: a curved or
 * elbowed arrow never passes through that midpoint, so the badge floated in empty
 * space, and in a real export it landed on an unrelated node's label and read as
 * that node's gravity. A badge that names the wrong thing is worse than one a
 * reader has to be told the position of.
 *
 * So the position is measured from the path by the renderer and passed in, and
 * `grounding.relations[].badge` states where it ended up. The check a reader could
 * do by recomputing, they now do by reading.
 */
export function relationImagePoint(
	relation: RelationGeometry,
	projection: GroundingProjection,
	scale: number
): Point {
	return toImagePoint(relation.midpoint, projection, scale)
}

/**
 * `[x1, y1, x2, y2]` in image pixels — the arrow's path, curve included.
 *
 * Deliberately the *path's* box and not the box its endpoints span. For a bowed
 * arrow those differ by the whole bow, and the smaller one would describe a region
 * the arrow leaves.
 */
export function relationImageAabb(
	relation: RelationGeometry,
	projection: GroundingProjection,
	scale: number
): [number, number, number, number] {
	const { minX, minY, maxX, maxY } = relation.bounds

	const topLeft = toImagePoint({ x: minX, y: minY }, projection, scale)
	const bottomRight = toImagePoint({ x: maxX, y: maxY }, projection, scale)

	return [topLeft.x, topLeft.y, bottomRight.x, bottomRight.y]
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
