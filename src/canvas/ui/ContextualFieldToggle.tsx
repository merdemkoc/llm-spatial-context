/**
 * Show or hide the contextual-field overlay.
 *
 * Sits with the Inspector rather than in the style panel so it works with nothing
 * selected — the overlay shows every node's field at once, so the switch has no
 * business being scoped to a selection.
 */
import { useValue } from 'tldraw'
import { showContextualFields } from '@/canvas/ui/contextualFieldVisibility'

export function ContextualFieldToggle() {
	const isShowing = useValue(showContextualFields)

	return (
		// The pointer-down guard matters as much as the change handler: without it
		// the event reaches the canvas and clears the selection, which tears down
		// whatever selection-scoped control the user was mid-edit in.
		<div onPointerDown={(event) => event.stopPropagation()} style={{ padding: 8 }}>
			<label
				style={{
					display: 'flex',
					gap: 6,
					alignItems: 'center',
					padding: '4px 8px',
					borderRadius: 4,
					border: '1px solid rgba(0, 0, 0, 0.2)',
					background: 'var(--tl-color-panel, #fff)',
					boxShadow: '0 1px 4px rgba(0, 0, 0, 0.1)',
					cursor: 'pointer',
					font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
					pointerEvents: 'all',
					userSelect: 'none',
				}}
			>
				<input
					type="checkbox"
					checked={isShowing}
					onChange={(event) => showContextualFields.set(event.target.checked)}
					style={{ margin: 0, cursor: 'pointer' }}
				/>
				Contextual fields
			</label>
		</div>
	)
}
