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

/**
 * Answers exactly one question — *which visual region of the screenshot
 * corresponds to this canonical entity?* — and deliberately no others. No
 * relations, no influence, no reading of what a region contains.
 */
export interface Grounding {
	image: ImageSize
	nodes: Record<VisualId, GroundedNodeRegion>
}
