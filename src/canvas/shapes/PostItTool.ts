/**
 * Click the canvas to drop a post-it.
 *
 * Creation deliberately runs canonical-model-first: a Node is built, then
 * projected into a tldraw shape. The shape is never the source of truth, not
 * even at the moment it comes into existence.
 *
 * A new post-it opens with a contextual field. The domain still defaults nothing —
 * `createPostItNode` leaves the key off unless given a radius — so this is the tool making
 * an explicit choice and writing it in, not the model inventing one on read. Without it
 * every note arrived reaching nowhere, and the idea the prototype exists to show was
 * invisible until you found the panel. **Clear** takes it away per note.
 */
import { StateNode } from 'tldraw'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { createNodeId } from '@/canvas/adapter/ids'
import { SUGGESTED_RADIUS } from '@/canvas/adapter/contextualField'
import { nodeToShape } from '@/canvas/adapter/adapter'
import {
	createPostItNode,
	POST_IT_DEFAULT_HEIGHT,
	POST_IT_DEFAULT_WIDTH,
	type PostItNode,
} from '@/domain'

/**
 * The node a click drops: centred on the point, opening with a field.
 *
 * Exported so what the tool decides can be tested without synthesizing pointer events —
 * and so the test drives the real decision rather than a copy of it. The suite around this
 * had its own hand-rolled stand-in for the tool, which is why nobody noticed that new notes
 * arrived with no field at all.
 */
export function postItAt(point: { x: number; y: number }): PostItNode {
	return createPostItNode({
		id: createNodeId(),
		// Centre the new post-it on the click point.
		x: point.x - POST_IT_DEFAULT_WIDTH / 2,
		y: point.y - POST_IT_DEFAULT_HEIGHT / 2,
		radius: SUGGESTED_RADIUS,
	})
}

export class PostItTool extends StateNode {
	static override id = POST_IT_SHAPE_TYPE

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onPointerDown() {
		const { editor } = this

		// v5: `inputs` exposes methods, not properties.
		const shape = nodeToShape(postItAt(editor.inputs.getCurrentPagePoint()))

		// A brand new node has no meaningful place in the stacking order yet;
		// dropping the index lets tldraw put it on top, and the canonical
		// `spatial.order` picks up whatever it assigns.
		delete shape.index

		editor.createShape({ ...shape, parentId: editor.getCurrentPageId() })

		// Hand control back to select, then drop straight into text editing.
		editor.setCurrentTool('select')
		editor.select(shape.id)
		editor.setEditingShape(shape.id)
	}
}
