/**
 * Example custom tool: click the canvas to drop a note card.
 *
 * A reference implementation of the tldraw v5 tool API — tools are state
 * machine nodes (`StateNode`). Safe to delete alongside the note card shape.
 */
import { StateNode, createShapeId } from 'tldraw'
import {
	NOTE_CARD_DEFAULT_HEIGHT,
	NOTE_CARD_DEFAULT_WIDTH,
	NOTE_CARD_TYPE,
} from '@/shapes/NoteCardShapeUtil'

export class NoteCardTool extends StateNode {
	static override id = NOTE_CARD_TYPE

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onPointerDown() {
		const { editor } = this

		// v5: `inputs` exposes methods, not properties.
		const { x, y } = editor.inputs.getCurrentPagePoint()

		const id = createShapeId()
		editor.createShape({
			id,
			type: NOTE_CARD_TYPE,
			// Centre the new card on the click point.
			x: x - NOTE_CARD_DEFAULT_WIDTH / 2,
			y: y - NOTE_CARD_DEFAULT_HEIGHT / 2,
		})

		// Hand control back to the select tool with the new shape selected.
		editor.setCurrentTool('select')
		editor.select(id)
	}
}
