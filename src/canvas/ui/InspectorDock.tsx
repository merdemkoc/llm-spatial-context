/**
 * The top-right corner: a rail of two buttons, with the Inspector hanging beneath it.
 *
 * tldraw stacks `SharePanel` and then `StylePanel` in a single top-right column, so
 * anything permanent here pushes the style panel down the screen. Only the two triggers
 * are permanent; the Inspector itself is on demand, and while it is closed the style
 * panel sits where tldraw means it to — just below the rail.
 *
 * The rail is a row because `.tlui-share-zone` is already a row; the previous column
 * fought the zone's own layout. Its `open` state lives here rather than inside
 * `InspectorPanel` because the trigger and the panel are siblings: one is in the rail, the
 * other below it.
 */
import { useState } from 'react'
import { TldrawUiButton, TldrawUiButtonIcon, TldrawUiButtonLabel } from 'tldraw'
import { InspectorPanel } from '@/canvas/ui/InspectorPanel'
import { ViewSettingsPopover } from '@/canvas/ui/ViewSettingsPopover'
import { MONO, panelChrome } from '@/canvas/ui/theme'

export function InspectorDock() {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'flex-end',
				gap: 'var(--tl-space-2)',
				margin: 'var(--tl-space-3)',
			}}
		>
			{/* The pointer-down guard matters as much as the click handlers: without it the
			    event reaches the canvas and clears the selection, which tears down whatever
			    selection-scoped control the user was mid-edit in. */}
			<div
				onPointerDown={(event) => event.stopPropagation()}
				style={{
					...panelChrome,
					display: 'flex',
					alignItems: 'center',
					font: MONO,
					pointerEvents: 'all',
					overflow: 'hidden',
				}}
			>
				<ViewSettingsPopover />
				<TldrawUiButton
					type="normal"
					isActive={isOpen}
					onClick={() => setIsOpen(!isOpen)}
					tooltip="The canvas as canonical JSON, plus the derived signals"
				>
					<TldrawUiButtonIcon icon="code" />
					<TldrawUiButtonLabel>Canonical JSON</TldrawUiButtonLabel>
				</TldrawUiButton>
			</div>

			{isOpen && <InspectorPanel onClose={() => setIsOpen(false)} />}
		</div>
	)
}
