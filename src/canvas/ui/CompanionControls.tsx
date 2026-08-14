/**
 * The AI companion's two switches.
 *
 * Two independent controls, per MVP-2: **AI observation** gates whether the model is
 * consulted at all, **Voice** gates only speech. They apply to the whole canvas rather
 * than to a selection, which is why they live with the other view switches in
 * `ViewSettingsPopover` and not in the style panel.
 *
 * Renders bare: the popover supplies the surface, the padding and the font.
 */
import { useValue } from 'tldraw'
import { observationEnabled, voiceEnabled } from '@/companion/companionState'
import { switchRow, checkbox } from '@/canvas/ui/theme'

export function CompanionControls() {
	const observing = useValue(observationEnabled)
	const voicing = useValue(voiceEnabled)

	return (
		<>
			<label style={switchRow}>
				<input
					type="checkbox"
					checked={observing}
					onChange={(event) => observationEnabled.set(event.target.checked)}
					style={checkbox}
				/>
				AI observation
			</label>
			<label style={switchRow}>
				<input
					type="checkbox"
					checked={voicing}
					onChange={(event) => voiceEnabled.set(event.target.checked)}
					style={checkbox}
				/>
				Voice
			</label>
		</>
	)
}
