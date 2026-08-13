/**
 * The "✦ Agent…" hint, while the companion works.
 *
 * Shown only between an episode closing and the voice starting — minimal, unobtrusive, and
 * clearly the AI's, per MVP-2 §6. It renders nothing when idle, which is what lets
 * `CompanionBar` swap it in for the resting chip rather than stack the two.
 *
 * That gap is about five seconds: roughly three for the model to decide whether the change
 * is worth a remark, then two for the sentence to be turned into speech. Two things make it
 * bearable without shortening it. It **says which job it is on**, because "still thinking"
 * and "already thought, now finding a voice" are different news. And it **moves**, because
 * five seconds of static text reads as a hang, and the one thing this hint must never look
 * like is nothing happening.
 *
 * The motion is `generative-loaders`' `InlineLoader`, which brings its own reduced-motion
 * handling and takes its colour from `currentColor` — so the loader is the field ink too,
 * the same voice that draws the contextual fields and the influence badges.
 */
import { useValue } from 'tldraw'
import { InlineLoader } from 'generative-loaders'
import { companionStage } from '@/companion/companionState'
import { FIELD_INK, MONO, fieldTint, panelChrome } from '@/canvas/ui/theme'

const LABELS = {
	observing: 'Agent thinking',
	composing: 'Agent finding a voice',
} as const

export function AgentThinkingIndicator() {
	const stage = useValue(companionStage)
	if (stage === 'idle') return null

	return (
		<div
			aria-live="polite"
			style={{
				...panelChrome,
				display: 'inline-flex',
				alignItems: 'center',
				gap: 'var(--tl-space-3)',
				padding: '4px var(--tl-space-4)',
				border: `1px solid ${fieldTint(0.4)}`,
				color: FIELD_INK,
				font: MONO,
				pointerEvents: 'none',
				userSelect: 'none',
				whiteSpace: 'nowrap',
			}}
		>
			{/* No `label`: the text beside it already names the activity, so the loader stays
			    `aria-hidden` and the live region announces the label alone rather than both. */}
			<InlineLoader variant="ripple" size={24} />
			{LABELS[stage]}
		</div>
	)
}
