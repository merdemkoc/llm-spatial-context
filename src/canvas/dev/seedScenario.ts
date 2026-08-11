/**
 * The demonstration scene from the MVP 1 spec (§8).
 *
 * A one-call setup so the walkthrough always starts from the same state: three post-its,
 * A carrying a contextual field, B parked *outside* that field so dragging it in fires
 * `field_entered`, and C already inside it so the influence table isn't empty. From here
 * the steps are all manual — approach, cross the boundary, retreat, draw a relation, then
 * drag the connected node away to show proximity and intent diverging.
 *
 * A development convenience, wired to `window.seedDemoScene` in DEV alongside
 * `window.editor`. Nothing in the app depends on it.
 */
import type { Editor } from 'tldraw'
import { createPostItNode } from '@/domain'
import { createNodeId } from '@/canvas/adapter/ids'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { isPostItShape } from '@/canvas/shapes/postItShape'
import { isRelationArrow } from '@/canvas/adapter/relations'

/** A's field reaches 500 world units; B at 700 is out of range, C at 300 is inside. */
const FIELD_RADIUS = 500

export function seedDemoScene(editor: Editor): void {
	const pageId = editor.getCurrentPageId()

	const nodes = [
		createPostItNode({ id: createNodeId(), x: 0, y: 0, radius: FIELD_RADIUS, text: 'A' }),
		createPostItNode({ id: createNodeId(), x: 700, y: 0, text: 'B' }),
		createPostItNode({ id: createNodeId(), x: 0, y: 300, text: 'C' }),
	]

	// One undo step, and a clean slate: the seed is a *reset* to a known state, so it
	// clears the post-its and relation arrows already on the canvas rather than adding a
	// second overlapping scene on top of them.
	editor.run(() => {
		const existing = editor
			.getCurrentPageShapes()
			.filter((shape) => isPostItShape(shape) || isRelationArrow(shape))
			.map((shape) => shape.id)
		if (existing.length) editor.deleteShapes(existing)

		editor.createShapes(nodes.map((node) => ({ ...nodeToShape(node), parentId: pageId })))
	})
}
