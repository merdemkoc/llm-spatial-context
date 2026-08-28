/**
 * The AI companion's two switches, and the rhythm it has settled into.
 *
 * Two independent controls, per MVP-2: **AI observation** gates whether the model is
 * consulted at all, **Voice** gates only speech. They apply to the whole canvas rather
 * than to a selection, which is why they live with the other view switches in
 * `ViewSettingsPopover` and not in the style panel.
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
	groupingSuggestion,
	observationEnabled,
	requestGrouping,
	voiceEnabled,
} from '@/companion/companionState'
import { switchRow, checkbox, caption, panelButton } from '@/canvas/ui/theme'

export function CompanionControls() {
	const observing = useValue(observationEnabled)
	const voicing = useValue(voiceEnabled)
	const pacing = useValue(companionPacing)
	const request = useValue(requestGrouping)
	const pending = useValue(groupingSuggestion)

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
			{/* One decimal, because the pause moves in fractions of a second and rounding to
			    whole ones would show it as stuck. The dropped count is omitted until there is
			    one: a permanent "· 0 dropped" reads as a warning about nothing. */}
			<div style={{ ...caption, paddingLeft: 'var(--tl-space-2)' }}>
				Pause {(pacing.idleMs / 1000).toFixed(1)}s
				{pacing.dropped > 0 && ` · ${pacing.dropped} dropped`}
			</div>
			{/* On-demand grouping. Disabled when the companion is asleep, when nothing is mounted to
			    ask, or when a proposal is already on the canvas waiting to be decided — mirroring the
			    orchestrator's own guards, so the button can't request something the loop would drop. */}
			<button
				type="button"
				style={panelButton}
				disabled={!request || !observing || pending !== null}
				onClick={() => request?.()}
			>
				✦ Suggest a grouping
			</button>
		</>
	)
}
