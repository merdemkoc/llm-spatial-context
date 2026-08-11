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
	GroundedRelationRegion,
	ImageSize,
	Relation,
	RelationGeometry,
	RelationId,
	VisualId,
} from '@/domain'
import {
	groundingProjection,
	nodeImageAabb,
	relationImageAabb,
	relationImagePoint,
	type GroundingProjection,
} from '@/canvas/grounding/projection'
import {
	assignRelationVisualIds,
	assignVisualIds,
	type GroundedNode,
	type GroundedRelation,
} from '@/canvas/grounding/visualId'
import { GROUNDING_PADDING, type RelationAnnotation } from '@/canvas/grounding/annotationLayer'

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
	image: ImageSize,
	labelledRelations: GroundedRelation[] = []
): Grounding {
	const nodes: Record<VisualId, GroundedNodeRegion> = {}
	const relations: Record<VisualId, GroundedRelationRegion> = {}

	// Guarded rather than divided: an empty canvas has no bounds, and `0 / 0` would
	// put a NaN in every bbox. There is nothing to ground that would need a scale.
	const scale = labelled.length && projection.width > 0 ? image.width / projection.width : 0

	for (const { visualId, node } of labelled) {
		nodes[visualId] = {
			nodeId: node.id,
			bbox: round(nodeImageAabb(node, projection, scale)),
		}
	}

	// Only when there are nodes to ground against — `scale` is 0 otherwise, and a
	// row of zeroes would claim an arrow sits in the image's top-left corner.
	if (scale > 0) {
		for (const { visualId, geometry } of labelledRelations) {
			const badge = relationImagePoint(geometry, projection, scale)

			relations[visualId] = {
				relationId: geometry.relationId,
				bbox: round(relationImageAabb(geometry, projection, scale)),
				badge: [Math.round(badge.x), Math.round(badge.y)],
			}
		}
	}

	// Copied, not held. The export measures the image from a decoded `ImageBitmap`,
	// whose `width`/`height` are prototype getters — keeping that object would
	// serialise `image` as `{}` and quietly lose the dimensions the bboxes are
	// relative to.
	return { image: { width: image.width, height: image.height }, nodes, relations }
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
export function deriveGrounding(
	nodes: CanvasNode[],
	relations: RelationGeometry[] = []
): Grounding {
	const projection = groundingProjection(nodes, GROUNDING_PADDING, relations)

	return buildGrounding(
		assignVisualIds(nodes),
		projection,
		predictedImageSize(projection),
		assignRelationVisualIds(relations)
	)
}

/**
 * `R1 g 1.00` — which arrow this is, then how strongly the user asserted it.
 *
 * The `g` is load-bearing: an image already carries distances, sizes and node
 * labels, and a bare `0.35` beside an arrow could be read as any of them. Two
 * decimals because gravity is a 0–1 scale a person set by hand — `1.00` and `0.35`
 * are the resolutions that get used, and a fixed width keeps badges uniform.
 *
 * The `R1` is load-bearing for a different reason: two relations at the same
 * gravity produced two identical badges, so a reader could see *that* there were
 * two and never which was which. It is also the key into
 * `grounding.relations`, which is what makes the mark joinable to the JSON.
 */
export function formatGravity(gravity: number, visualId?: VisualId): string {
	const strength = `g ${gravity.toFixed(2)}`
	return visualId === undefined ? strength : `${visualId} ${strength}`
}

/**
 * A badge per relation, for the exported PNG.
 *
 * Driven by the *labelled geometry* rather than by the relations record, because
 * the geometry is what knows where the arrow actually runs — and an arrow the
 * renderer couldn't measure gets no badge rather than one at a guessed position.
 *
 * A geometry whose relation is no longer in the document is skipped for the same
 * reason: `getCanvasRelations` and the geometry read come from the same page, but
 * an imported document can disagree with itself, and a badge floating over nothing
 * is worse than a missing badge.
 */
export function relationAnnotations(
	relations: Record<RelationId, Relation>,
	labelledRelations: GroundedRelation[],
	projection: GroundingProjection,
	scale: number
): RelationAnnotation[] {
	const annotations: RelationAnnotation[] = []

	for (const { visualId, geometry } of labelledRelations) {
		const relation = relations[geometry.relationId]
		if (!relation) continue

		annotations.push({
			label: formatGravity(relation.gravity, visualId),
			at: relationImagePoint(geometry, projection, scale),
		})
	}

	return annotations
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
