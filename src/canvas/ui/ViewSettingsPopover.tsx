/**
 * The three switches, behind one button.
 *
 * None of them describes the canvas — they are preferences about looking and about
 * whether the companion is awake — so they earn a click rather than permanent screen
 * space. Collecting them here is what let the top-right corner go back to being two
 * buttons instead of a column of five cards.
 *
 * A tldraw popover rather than a bespoke one: it portals into the editor container, takes
 * the editor's own panel chrome and shadow, closes on Escape and on outside pointer-down,
 * and registers with tldraw's open-menu bookkeeping so the canvas knows a menu is up.
 */
import {
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiPopover,
	TldrawUiPopoverContent,
	TldrawUiPopoverTrigger,
} from 'tldraw'
import { ContextualFieldToggle } from '@/canvas/ui/ContextualFieldToggle'
import { CompanionControls } from '@/canvas/ui/CompanionControls'
import { MONO, caption } from '@/canvas/ui/theme'

export function ViewSettingsPopover() {
	return (
		<TldrawUiPopover id="canvas-view-settings">
			<TldrawUiPopoverTrigger>
				{/* An icon with no label needs the name spelled out: `tooltip` renders hover
				    text, which is not an accessible name. */}
				<TldrawUiButton
					type="icon"
					tooltip="View and companion settings"
					aria-label="View and companion settings"
				>
					<TldrawUiButtonIcon icon="dots-horizontal" />
				</TldrawUiButton>
			</TldrawUiPopoverTrigger>
			<TldrawUiPopoverContent side="bottom" align="end">
				{/* The pointer-down guard matters as much as the switches themselves: without it
				    the event reaches the canvas and clears the selection, which tears down
				    whatever selection-scoped control the user was mid-edit in. */}
				<div
					onPointerDown={(event) => event.stopPropagation()}
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 'var(--tl-space-3)',
						padding: 'var(--tl-space-4)',
						font: MONO,
						userSelect: 'none',
						width: 190,
					}}
				>
					<span style={caption}>View</span>
					<ContextualFieldToggle />
					<span style={{ ...caption, marginTop: 'var(--tl-space-2)' }}>✦ AI companion</span>
					<CompanionControls />
				</div>
			</TldrawUiPopoverContent>
		</TldrawUiPopover>
	)
}
