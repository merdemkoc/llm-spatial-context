/**
 * Editing the contextual field through the editor.
 *
 * This lives here rather than inside the style panel so it can be tested
 * against a real editor: the panel is then only responsible for what the user
 * sees, not for getting the meta write right. tldraw is a *type-only* import,
 * so importing this pulls no tldraw runtime code.
 */
import type { Editor, TLShapeId } from 'tldraw'
import { isPostItShape } from '@/canvas/shapes/postItShape'
import { contextualFieldPatch } from '@/canvas/adapter/adapter'

/**
 * Sets the contextual-field radius on the given post-its, or clears the field
 * when `radius` is null.
 *
 * Takes explicit ids rather than reading the current selection, and that
 * distinction is the whole point. A radius is committed when the input loses
 * focus — and the click that moves focus usually lands somewhere that changes
 * the selection first, so "apply to whatever is selected now" would apply it to
 * nothing, silently. The caller captures the ids up front instead.
 *
 * Returns how many nodes changed, so a caller can tell "those shapes are gone"
 * from "it worked" rather than failing quietly.
 */
export function setContextualFieldRadius(
	editor: Editor,
	ids: TLShapeId[],
	radius: number | null
): number {
	const shapes = ids
		.map((id) => editor.getShape(id))
		.filter((shape) => shape !== undefined)
		.filter(isPostItShape)

	if (!shapes.length) return 0

	editor.markHistoryStoppingPoint('set contextual field radius')
	editor.updateShapes(
		shapes.map((shape) => ({
			id: shape.id,
			type: shape.type,
			meta: contextualFieldPatch(radius === null ? undefined : { radius }),
		}))
	)

	return shapes.length
}

/** The post-its in the current selection, in selection order. */
export function selectedPostItIds(editor: Editor): TLShapeId[] {
	return editor
		.getSelectedShapes()
		.filter(isPostItShape)
		.map((shape) => shape.id)
}
