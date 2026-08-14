/**
 * Show or hide the contextual-field overlay.
 *
 * A preference about looking, not a fact about the canvas, and it applies to every node
 * at once — so it belongs with the other view switches in `ViewSettingsPopover` rather
 * than in the style panel, which is scoped to a selection.
 *
 * Renders bare: the popover supplies the surface, the padding and the font.
 */
import { useValue } from 'tldraw'
import { showContextualFields } from '@/canvas/ui/contextualFieldVisibility'
import { switchRow, checkbox } from '@/canvas/ui/theme'

export function ContextualFieldToggle() {
	const isShowing = useValue(showContextualFields)

	return (
		<label style={switchRow}>
			<input
				type="checkbox"
				checked={isShowing}
				onChange={(event) => showContextualFields.set(event.target.checked)}
				style={checkbox}
			/>
			Contextual fields
		</label>
	)
}
