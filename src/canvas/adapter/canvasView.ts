/**
 * The canonical Canvas, derived from the editor.
 *
 * tldraw's store is the single runtime store; the canonical model is a view
 * over it. That is what makes "moving the Post-it updates the canonical Node"
 * true by construction rather than by synchronisation — there is no second
 * store to fall out of step, and undo/redo, persistence and cross-tab sync all
 * keep working untouched.
 *
 * One Canvas is one tldraw page. The page menu is hidden in the UI config to
 * keep that honest.
 */
import { useEditor, useValue, type Editor } from 'tldraw'
import type { CanvasDocument, CanvasNode, NodeId } from '@/domain'
import { isPostItShape } from '@/canvas/shapes/postItShape'
import { shapeToNode } from '@/canvas/adapter/adapter'

const PAGE_ID_PREFIX = 'page:'

export function getCanvasDocument(editor: Editor): CanvasDocument {
	const nodes: Record<NodeId, CanvasNode> = {}

	for (const shape of editor.getCurrentPageShapes()) {
		if (!isPostItShape(shape)) continue

		// Resolve world coordinates properly: shape.x/y are parent-relative, so
		// a post-it inside a frame or group would otherwise report the wrong
		// position.
		const transform = editor.getShapePageTransform(shape)
		const node = shapeToNode(
			shape,
			transform ? { ...transform.point(), rotation: transform.rotation() } : undefined
		)

		nodes[node.id] = node
	}

	const timestamps = Object.values(nodes).map((node) => node.metadata)
	const pageId = editor.getCurrentPageId()

	return {
		id: pageId.startsWith(PAGE_ID_PREFIX) ? pageId.slice(PAGE_ID_PREFIX.length) : pageId,
		nodes,
		// Relations are graph-level entities with a place in the model and no
		// implementation yet. Nothing populates this.
		relations: {},
		metadata: {
			createdAt: min(timestamps.map((t) => t.createdAt)),
			updatedAt: max(timestamps.map((t) => t.updatedAt)),
		},
	}
}

export function useCanvasDocument(): CanvasDocument {
	const editor = useEditor()
	return useValue('canvas document', () => getCanvasDocument(editor), [editor])
}

function min(values: string[]): string {
	return values.length ? values.reduce((a, b) => (a < b ? a : b)) : new Date().toISOString()
}

function max(values: string[]): string {
	return values.length ? values.reduce((a, b) => (a > b ? a : b)) : new Date().toISOString()
}
