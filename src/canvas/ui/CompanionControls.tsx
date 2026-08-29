/**
 * The AI companion's three switches, and the rhythm it has settled into.
 *
 * Three independent controls: **AI observation** gates whether the model is consulted at
 * all, **Voice** gates only speech, and **Follow** gates whether the canvas moves to
 * whatever a remark is about. They apply to the whole canvas rather than to a selection,
 * which is why they live with the other view switches in `ViewSettingsPopover` and not in
 * the style panel.
 *
 * Follow is last because it is the most assertive: the other two decide whether the
 * companion says anything, this one lets it move the board under your hands. A sentence can
 * be ignored while you carry on working; a camera move cannot.
 *
 * Below them, a readout rather than a control: how long the canvas must now fall quiet
 * before the companion starts thinking, and how many thoughts it has thrown away because
 * the user came back first. The pause moves on its own, and a number that moves on its own
 * and cannot be seen is indistinguishable from a bug — the same argument the event log and
 * the canonical JSON panel make about derived spatial state. It is deliberately not
 * adjustable: the point of the mechanism is that it works this out better than a slider.
 *
 * Renders bare: the popover supplies the surface, the padding and the font.
 */
import { useValue } from 'tldraw'
import {
	companionPacing,
	followEnabled,
	observationEnabled,
	voiceEnabled,
} from '@/companion/companionState'
import { switchRow, checkbox, caption } from '@/canvas/ui/theme'

export function CompanionControls() {
	const observing = useValue(observationEnabled)
	const voicing = useValue(voiceEnabled)
	const following = useValue(followEnabled)
	const pacing = useValue(companionPacing)

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
			<label style={switchRow}>
				<input
					type="checkbox"
					checked={following}
					onChange={(event) => followEnabled.set(event.target.checked)}
					style={checkbox}
				/>
				Follow
			</label>
			{/* One decimal, because the pause moves in fractions of a second and rounding to
			    whole ones would show it as stuck. The dropped count is omitted until there is
			    one: a permanent "· 0 dropped" reads as a warning about nothing. */}
			<div style={{ ...caption, paddingLeft: 'var(--tl-space-2)' }}>
				Pause {(pacing.idleMs / 1000).toFixed(1)}s
				{pacing.dropped > 0 && ` · ${pacing.dropped} dropped`}
			</div>
		</>
	)
}
