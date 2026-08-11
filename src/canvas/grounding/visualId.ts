/**
 * Short labels that let a reader point at a node in an image and name it.
 *
 * `N1` is **a position within one export, not an identity.** The node id is the
 * identity — that is the whole reason the grounding map exists. Moving a node
 * can renumber every label, so a label only means anything alongside the image
 * and the `grounding` map it was generated with.
 *
 * Order is reading order: centre `y`, then centre `x`, then node id. The final
 * tiebreak isn't decoration — without it two coincident nodes would come out in
 * whatever order `nodes` happened to be in, and `Record` iteration order is not
 * something the canonical document promises.
 */
import { nodeCenter, type CanvasNode, type VisualId } from '@/domain'

export interface GroundedNode {
	visualId: VisualId
	node: CanvasNode
}

/**
 * No row banding. Comparison on `y` is strict, so three notes laid out in a row
 * with tops jittered by a few pixels are numbered by that jitter rather than
 * left to right. Deterministic, but not always what a human reads — a tolerance
 * band would fix it and needs a magic constant, so it stays out of the MVP.
 */
export function assignVisualIds(nodes: CanvasNode[]): GroundedNode[] {
	// Copied before sorting: the caller's array is usually
	// `Object.values(document.nodes)`, and reordering that in place would be a
	// surprising side effect of asking for labels.
	return [...nodes]
		.map((node) => ({ node, center: nodeCenter(node) }))
		.sort(
			(a, b) => a.center.y - b.center.y || a.center.x - b.center.x || compare(a.node.id, b.node.id)
		)
		.map(({ node }, index) => ({ visualId: `N${index + 1}`, node }))
}

/**
 * Code-unit comparison, not `localeCompare`: node ids are opaque machine
 * strings, and a locale-sensitive collation would make the label order depend
 * on where the export ran.
 */
function compare(a: string, b: string): number {
	if (a < b) return -1
	return a > b ? 1 : 0
}
