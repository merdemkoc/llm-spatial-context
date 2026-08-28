/**
 * Accept or dismiss a pending grouping.
 *
 * The ghost overlay is inert — it only shows the proposal — so the decision lives here, the
 * one pointer-enabled piece. It floats just above the proposed cluster, in the
 * `InFrontOfTheCanvas` layer (screen space, above the shapes), and disappears the moment there
 * is nothing to decide.
 *
 * Accept calls the companion's published handle, which commits the move, affirms it once, and
 * suppresses the follow-up self-edit episode. Dismiss just clears the proposal — it changes
 * nothing on the canvas, so it needs no handle. The transcript keeps the rationale either way.
 */
import { useEditor, useValue } from 'tldraw'
import { acceptGrouping, groupingSuggestion } from '@/companion/companionState'
import { caption, panelButton, panelChrome } from '@/canvas/ui/theme'

export function GroupingControls() {
	const editor = useEditor()
	const suggestion = useValue(groupingSuggestion)
	const accept = useValue(acceptGrouping)
	// Subscribe to the camera so the panel tracks the cluster as the canvas pans and zooms.
	useValue('camera', () => editor.getCamera(), [editor])

	if (!suggestion || suggestion.targets.length === 0) return null

	// Anchor above the top-centre of the proposed targets. Approximate (it reads top-lefts, not
	// full box bounds), which is plenty for a floating control that only has to sit near the cluster.
	const minY = Math.min(...suggestion.targets.map((target) => target.y))
	const avgX =
		suggestion.targets.reduce((sum, target) => sum + target.x, 0) / suggestion.targets.length
	const anchor = editor.pageToViewport({ x: avgX, y: minY })

	return (
		<div
			data-grouping-controls=""
			onPointerDown={(event) => event.stopPropagation()}
			style={{
				...panelChrome,
				position: 'absolute',
				left: anchor.x,
				top: anchor.y,
				transform: 'translate(-50%, calc(-100% - 8px))',
				// The `OnTheCanvas` ghost is inert; this layer is where the click has to land.
				pointerEvents: 'all',
				display: 'flex',
				flexDirection: 'column',
				gap: 'var(--tl-space-2)',
				padding: 'var(--tl-space-3)',
				maxWidth: 280,
			}}
		>
			<span style={caption}>{suggestion.rationale}</span>
			<div style={{ display: 'flex', gap: 'var(--tl-space-2)' }}>
				<button type="button" style={panelButton} onClick={() => accept?.()}>
					Accept
				</button>
				<button type="button" style={panelButton} onClick={() => groupingSuggestion.set(null)}>
					Dismiss
				</button>
			</div>
		</div>
	)
}
