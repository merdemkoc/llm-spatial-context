/**
 * Click the canvas to drop a post-it.
 *
 * Creation deliberately runs canonical-model-first: a Node is built, then
 * projected into a tldraw shape. The shape is never the source of truth, not
 * even at the moment it comes into existence.
 */
import { StateNode } from 'tldraw'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { createNodeId } from '@/canvas/adapter/ids'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { createPostItNode, POST_IT_DEFAULT_HEIGHT, POST_IT_DEFAULT_WIDTH } from '@/domain'

export class PostItTool extends StateNode {
	static override id = POST_IT_SHAPE_TYPE

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onPointerDown() {
		const { editor } = this

		// v5: `inputs` exposes methods, not properties.
		const { x, y } = editor.inputs.getCurrentPagePoint()

		const node = createPostItNode({
			id: createNodeId(),
			// Centre the new post-it on the click point.
			x: x - POST_IT_DEFAULT_WIDTH / 2,
			y: y - POST_IT_DEFAULT_HEIGHT / 2,
		})

		const shape = nodeToShape(node)

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
