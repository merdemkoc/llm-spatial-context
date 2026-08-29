/**
 * Reflected ideas, turned into ghosts and then into notes.
 *
 * The reflection proposes note text; `planIdeaNotes` places each proposal in open space beside
 * the board (the client owns positions, the model never does), and `createAgentNotes` commits
 * the chosen ones as real post-its stamped `createdBy: 'agent'` — the provenance the model has
 * always carried, now actually written. It only ever creates notes; no connection is drawn.
 */
import type { Editor, TLShapePartial } from 'tldraw'
import { createPostItNode, placeNewNotes, type NodeId } from '@/domain'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { createNodeId } from '@/canvas/adapter/ids'
import { SUGGESTED_RADIUS } from '@/canvas/adapter/contextualField'
import type { GhostIdea } from '@/companion/companionState'
import type { IdeaProposal } from '@/companion/reflectClient'

/** Place the model's proposed ideas in open space, as ghosts awaiting a decision. */
export function planIdeaNotes(editor: Editor, proposals: IdeaProposal[]): GhostIdea[] {
	const existing = Object.values(getCanvasDocument(editor).nodes)
	const spots = placeNewNotes(existing, proposals.length)
	return proposals.map((proposal, index) => ({
		id: `idea-${index}`,
		text: proposal.text,
		kind: proposal.kind,
		x: spots[index].x,
		y: spots[index].y,
		...(proposal.connectTo
			? {
					connectTo: proposal.connectTo,
					...(proposal.connectLabel ? { connectLabel: proposal.connectLabel } : {}),
				}
			: {}),
	}))
}

/**
 * Commit new notes as agent-authored post-its, in one undo step. Each opens with a contextual
 * field, like a note the user drops, so it reaches somewhere from the start. Returns the new
 * notes' ids, in order — the caller needs them to draw any arrows to the notes.
 */
export function createAgentNotes(
	editor: Editor,
	notes: { text: string; x: number; y: number }[]
): NodeId[] {
	if (notes.length === 0) return []

	const pageId = editor.getCurrentPageId()
	const ids: NodeId[] = []
	const shapes: TLShapePartial[] = notes.map((note) => {
		const id = createNodeId()
		ids.push(id)
		const node = createPostItNode({
			id,
			x: note.x,
			y: note.y,
			text: note.text,
			radius: SUGGESTED_RADIUS,
			createdBy: 'agent',
		})
		const shape = nodeToShape(node)
		// A brand new node has no meaningful stacking order yet; dropping the index lets tldraw
		// place it on top and the canonical `spatial.order` picks up whatever it assigns.
		delete shape.index
		return { ...shape, parentId: pageId }
	})

	editor.markHistoryStoppingPoint('add agent ideas')
	editor.createShapes(shapes)
	return ids
}
