/**
 * A grouping, turned into moves.
 *
 * The suggester returns the ids of ideas that belong together; this is where those
 * ids become a concrete arrangement and, on accept, actual repositioned notes. It
 * is the one place the "grey arrow" writes back into the canvas — and it writes the
 * smallest possible thing: new positions. No node is created, no arrow is drawn, so
 * a grouping speaks the same language as the user dragging the notes themselves, and
 * "proximity never becomes a relation" holds.
 *
 * `planGrouping` reads the live canvas so the geometry runs on real coordinates the
 * model never sees; `applyGrouping` commits the planned targets as one undo step.
 */
import type { Editor, TLShapePartial } from 'tldraw'
import { computeClusterLayout, type ClusterPlacement, type NodeId } from '@/domain'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { isPostItShape, POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'

export interface GroupingPlan {
	/** The members that still exist, in the order the model gave them. */
	members: NodeId[]
	/** Where each member should move to — world top-lefts, computed from the live layout. */
	targets: ClusterPlacement[]
}

/**
 * Resolve the model's chosen ids against the live canvas and compute tidy targets.
 *
 * Returns `null` when fewer than two members survive — a grouping of one is no
 * grouping, and the ids can be stale by the time this runs.
 */
export function planGrouping(editor: Editor, memberIds: NodeId[]): GroupingPlan | null {
	const canvas = getCanvasDocument(editor)
	const members = memberIds.map((id) => canvas.nodes[id]).filter((node) => node !== undefined)
	if (members.length < 2) return null

	const memberSet = new Set(members.map((node) => node.id))
	const others = Object.values(canvas.nodes).filter((node) => !memberSet.has(node.id))
	const targets = computeClusterLayout(members, others)

	return { members: members.map((node) => node.id), targets }
}

/**
 * Move the members to their targets, as one undo step. Returns how many moved.
 *
 * A member deleted between the proposal and the accept is skipped rather than
 * fatal — the ghost the user accepted may name a note that is no longer there.
 * Targets are world coordinates; `getPointInParentSpace` converts them to each
 * shape's parent frame, which is the page (identity) for every note in this app but
 * stays correct if one ever sits inside a frame or group.
 */
export function applyGrouping(editor: Editor, plan: GroupingPlan): number {
	const updates = plan.targets.flatMap((target): TLShapePartial[] => {
		const shape = editor.getShape(nodeIdToShapeId(target.id))
		if (!shape || !isPostItShape(shape)) return []
		const local = editor.getPointInParentSpace(shape, target)
		return [{ id: shape.id, type: POST_IT_SHAPE_TYPE, x: local.x, y: local.y }]
	})
	if (updates.length === 0) return 0

	editor.markHistoryStoppingPoint('accept grouping')
	editor.updateShapes(updates)
	return updates.length
}
