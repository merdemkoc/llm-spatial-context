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
import { buildSpatialContext } from '@/domain'
import { isPostItShape } from '@/canvas/shapes/postItShape'
import { shapeToNode } from '@/canvas/adapter/adapter'
import { getCanvasRelations } from '@/canvas/adapter/relations'
import { deriveGrounding } from '@/canvas/grounding/grounding'

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
		// Read from the arrows the user drew — and from nothing else. Nothing here
		// populates relations from `spatialContext` below, or the reverse: one is
		// what the user said, the other is what the layout implies, and the whole
		// point of holding both is that a reader can tell them apart.
		relations: getCanvasRelations(editor, nodes),
		// Derived here, at the one place the document is assembled, so "the JSON
		// always reflects the current layout" needs no invalidation logic and no
		// manual trigger: every move, resize, radius change, addition and
		// deletion already produces a fresh document.
		spatialContext: buildSpatialContext(Object.values(nodes)),
		// Derived here for the same reason as `spatialContext`, and it is the same
		// kind of claim about a different coordinate system: where each node would
		// land in a screenshot of this canvas. The export replaces it with a version
		// measured from the bitmap it actually produced.
		grounding: deriveGrounding(Object.values(nodes)),
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
