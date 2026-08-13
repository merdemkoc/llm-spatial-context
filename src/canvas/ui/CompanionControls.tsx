/**
 * The AI companion's two switches.
 *
 * Sits in the top-right stack with the field toggle and the Inspector, not in the style
 * panel, because it applies to the whole canvas rather than a selection. Two independent
 * controls, per MVP-2: **AI observation** gates whether the model is consulted at all,
 * **Voice** gates only speech. The same pointer-down guard as the field toggle keeps a
 * click on the control from reaching the canvas and clearing the selection.
 */
import { useValue } from 'tldraw'
import { observationEnabled, voiceEnabled } from '@/companion/companionState'

export function CompanionControls() {
	const observing = useValue(observationEnabled)
	const voicing = useValue(voiceEnabled)

	return (
		<div onPointerDown={(event) => event.stopPropagation()} style={{ padding: 8 }}>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: 4,
					padding: 8,
					borderRadius: 4,
					border: '1px solid rgba(0, 0, 0, 0.2)',
					background: 'var(--tl-color-panel, #fff)',
					boxShadow: '0 1px 4px rgba(0, 0, 0, 0.1)',
					font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
					pointerEvents: 'all',
					userSelect: 'none',
				}}
			>
				<span style={{ opacity: 0.7 }}>✦ AI companion</span>
				<label style={switchStyle}>
					<input
						type="checkbox"
						checked={observing}
						onChange={(event) => observationEnabled.set(event.target.checked)}
						style={inputStyle}
					/>
					AI observation
				</label>
				<label style={switchStyle}>
					<input
						type="checkbox"
						checked={voicing}
						onChange={(event) => voiceEnabled.set(event.target.checked)}
						style={inputStyle}
					/>
					Voice
				</label>
			</div>
		</div>
	)
}

const switchStyle: React.CSSProperties = {
	display: 'flex',
	gap: 6,
	alignItems: 'center',
	cursor: 'pointer',
}

const inputStyle: React.CSSProperties = { margin: 0, cursor: 'pointer' }
