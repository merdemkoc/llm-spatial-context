/**
 * The grounding layer of a Canvas: which region of a screenshot each Node
 * occupies.
 *
 * Types only. The derivation lives in `src/canvas/grounding/`, because it depends
 * on how the canvas is actually rendered and exported — the padding a label needs,
 * the pixel ratio tldraw rasterises at — and those are rendering conventions the
 * canonical model has no business knowing. This is the same division as
 * `spatialContext`: the document declares the shape of the claim, the layer that
 * can see a renderer computes it.
 *
 * The unit is what matters here. `SpatialProperties` is in **canvas coordinates**;
 * everything below is in **screenshot pixels**. A reader who mixes them up gets
 * numbers that look plausible and point at nothing.
 */
import type { NodeId } from '@/domain/node'
import type { RelationId } from '@/domain/canvas'
import type { Point } from '@/domain/spatialInfluence'

/**
 * `N1`, `N2`, … One-indexed and contiguous, in reading order.
 *
 * A position within one grounding, **not an identity**. Moving a Node can
 * renumber every label; `NodeId` remains the only stable handle. The label exists
 * so a short token can be pointed at in an image, nothing more.
 */
export type VisualId = string

/** Pixel dimensions of the screenshot the bboxes are relative to. */
export interface ImageSize {
	width: number
	height: number
}

export interface GroundedNodeRegion {
	nodeId: NodeId

	/**
	 * `[x1, y1, x2, y2]` in screenshot pixels from the image's top-left — opposite
	 * corners, not `[x, y, width, height]`.
	 *
	 * Deliberately not canvas coordinates: `nodes[].spatial` already says where the
	 * Node is on the canvas, and this says where to look in the picture. For a
	 * rotated Node it is the smallest axis-aligned box containing it, since four
	 * numbers cannot express a rotation.
	 */
	bbox: [number, number, number, number]
}

/** An axis-aligned rectangle in **canvas coordinates**. */
export interface WorldBox {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

/**
 * Where a relation's arrow actually *runs*, in canvas coordinates.
 *
 * Input to the grounding layer rather than part of it, and the only thing in this
 * file that isn't a screenshot measurement. A `Relation` says which two nodes are
 * connected; it deliberately carries no anchor, bend or terminal, because those
 * are draughtsmanship rather than claim. But a curve on an image has a position,
 * and the grounding layer cannot invent one: the midpoint of the two node centres
 * is a point a bowed arrow never passes through.
 *
 * So the renderer measures the drawn path and hands the result in. That is the
 * same division the rest of this file follows — the model declares the shape of
 * the claim, the layer that can see a renderer supplies the pixels.
 */
export interface RelationGeometry {
	relationId: RelationId

	/**
	 * The drawn path's bounding box, curve included — not the box spanned by the two
	 * endpoints. An arrow that bows outside its nodes has bounds outside theirs, and
	 * an export sized only to the nodes clips exactly that overhang.
	 */
	bounds: WorldBox

	/** A point **on** the drawn path, near its middle. Where a badge belongs. */
	midpoint: Point
}

export interface GroundedRelationRegion {
	relationId: RelationId

	/** `[x1, y1, x2, y2]` in screenshot pixels — the arrow's path, curve included. */
	bbox: [number, number, number, number]

	/**
	 * `[x, y]` in screenshot pixels: the centre of the badge drawn for this relation.
	 *
	 * Stated rather than left to be re-derived. The badge used to sit at a position a
	 * reader could recompute from two node centres — which was its justification, and
	 * also why it drifted off every curved arrow. Reading the real path is what fixes
	 * the placement, and saying where the badge went is what replaces the lost
	 * re-derivability: a reader can still check the picture against the JSON, they
	 * just read the answer instead of recomputing it.
	 */
	badge: [number, number]
}

/**
 * Answers exactly one question — *which visual region of the screenshot
 * corresponds to this canonical entity?* — and deliberately no others. No
 * influence, no reading of what a region contains.
 *
 * Both nodes and relations are indexed, because both are things the user made and
 * both are visible in the picture. An arrow used to be left out on the grounds
 * that `relations` already names its endpoints and `nodes` maps those to `N1`,
 * `N2`… — true of its *identity*, but silent about its *pixels*, which is the one
 * question this layer exists to answer.
 */
export interface Grounding {
	image: ImageSize
	nodes: Record<VisualId, GroundedNodeRegion>

	/**
	 * Keyed `R1`, `R2`, … in reading order — the same convention, and the same
	 * caveat, as the node labels: a position within one export, never an identity.
	 * `relationId` inside is the stable handle.
	 */
	relations: Record<VisualId, GroundedRelationRegion>
}
