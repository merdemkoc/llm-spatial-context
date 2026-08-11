/**
 * Deriving the grounding layer — which region of a screenshot each Node occupies.
 *
 * The shape of the claim is declared in `src/domain/grounding.ts`. Computing it
 * belongs here, because it needs two things the canonical model shouldn't know:
 * the padding a label needs around the outermost node, and the pixel ratio tldraw
 * rasterises at. Those are rendering conventions, so the rendering side owns them.
 *
 * `grounding` is derived on every read, exactly like `spatialContext` — output,
 * never input. It describes the screenshot the canvas *would* export right now,
 * which is a knowable thing: the export bounds come from the nodes, and the pixel
 * ratio is fixed. The export still measures the bitmap it actually produced and
 * replaces this with the measured version, so a saved artifact always describes
 * its own PNG rather than a prediction about it.
 */
import type {
	CanvasDocument,
	CanvasNode,
	Grounding,
	GroundedNodeRegion,
	ImageSize,
	VisualId,
} from '@/domain'
import {
	groundingProjection,
	nodeImageAabb,
	type GroundingProjection,
} from '@/canvas/grounding/projection'
import { assignVisualIds, type GroundedNode } from '@/canvas/grounding/visualId'
import { GROUNDING_PADDING } from '@/canvas/grounding/annotationLayer'

/**
 * Screenshot pixels per world unit, as tldraw's bitmap export produces them:
 * `scale` 1 × `pixelRatio` 2.
 *
 * This makes the exported image size predictable, which is what lets a live
 * document carry a grounding layer at all. It is a prediction, not a measurement
 * — `imageScale` measures the real thing at export time, and the two agree unless
 * the browser clamps an enormous canvas.
 */
export const EXPORT_PIXELS_PER_WORLD_UNIT = 2

/**
 * Whole pixels. A screenshot has no sub-pixel positions to point at, and
 * `456.30000000000007` is noise in a document meant to be read — the same reason
 * `buildSpatialContext` rounds distances. `nodeImageAabb` stays exact for
 * anything doing further arithmetic.
 */
function round(bbox: [number, number, number, number]): [number, number, number, number] {
	return [Math.round(bbox[0]), Math.round(bbox[1]), Math.round(bbox[2]), Math.round(bbox[3])]
}

/**
 * Takes the labelling the image was drawn with, so the map and the annotations
 * cannot disagree about which node is `N1`.
 *
 * The scale is recovered from the image's own width rather than passed in, which
 * is what keeps a bbox in the JSON in the same pixel space as the outline drawn on
 * the PNG.
 *
 * **Validates nothing, and must not.** This runs inside `getCanvasDocument`, which
 * runs inside a reactive computed — anything thrown here takes the editor down
 * rather than showing a bad number. Whether an image really is the rectangle that
 * was requested is `imageScale`'s question, asked by the export about a bitmap it
 * actually has.
 */
export function buildGrounding(
	labelled: GroundedNode[],
	projection: GroundingProjection,
	image: ImageSize
): Grounding {
	const nodes: Record<VisualId, GroundedNodeRegion> = {}

	// Guarded rather than divided: an empty canvas has no bounds, and `0 / 0` would
	// put a NaN in every bbox. There is nothing to ground that would need a scale.
	const scale = labelled.length && projection.width > 0 ? image.width / projection.width : 0

	for (const { visualId, node } of labelled) {
		nodes[visualId] = {
			nodeId: node.id,
			bbox: round(nodeImageAabb(node, projection, scale)),
		}
	}

	// Copied, not held. The export measures the image from a decoded `ImageBitmap`,
	// whose `width`/`height` are prototype getters — keeping that object would
	// serialise `image` as `{}` and quietly lose the dimensions the bboxes are
	// relative to.
	return { image: { width: image.width, height: image.height }, nodes }
}

/**
 * The pixel size the export would produce for these bounds.
 *
 * Floored, because that is what the export does: it rasterises at
 * `bounds × scale × pixelRatio` and floors to whole pixels. Predicting the same
 * way is what keeps a live document's `image` equal to the PNG's real dimensions.
 */
export function predictedImageSize(projection: GroundingProjection): ImageSize {
	return {
		width: Math.floor(projection.width * EXPORT_PIXELS_PER_WORLD_UNIT),
		height: Math.floor(projection.height * EXPORT_PIXELS_PER_WORLD_UNIT),
	}
}

/**
 * The grounding layer for a set of nodes, as `getCanvasDocument` derives it.
 *
 * No editor and no screenshot needed: the bounds come from the nodes and the
 * pixel ratio is fixed, so the layer can be derived on every read the way
 * `buildSpatialContext` is.
 */
export function deriveGrounding(nodes: CanvasNode[]): Grounding {
	const projection = groundingProjection(nodes, GROUNDING_PADDING)

	return buildGrounding(assignVisualIds(nodes), projection, predictedImageSize(projection))
}

/**
 * Replaces a document's derived grounding with one measured from a real image.
 *
 * `grounding` is already a key on `canvas`, so spreading keeps it in its declared
 * position rather than moving it to the end of the document.
 */
export function groundedDocument(canvas: CanvasDocument, grounding: Grounding): CanvasDocument {
	return { ...canvas, grounding }
}
