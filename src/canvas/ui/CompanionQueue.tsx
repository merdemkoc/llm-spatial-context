/**
 * What the companion has lined up to say *next*.
 *
 * The companion used to hold one thought and throw it away the moment you touched the board
 * again, so there was never a queue to show. It now keeps every gesture's observation and works
 * through them in turn — which makes "what is it about to say" a list, and a list nobody can
 * see is indistinguishable from a companion that has gone quiet for no reason. The same
 * argument the pacing readout and the event log already make: if the app derives something, the
 * app should be willing to show it.
 *
 * The chips name the gesture rather than the remark, because the remark does not exist yet for
 * most of them, and because naming the gesture is what makes the row read as *your* actions
 * being worked through rather than as a progress bar. The one currently being spoken is left
 * out: it is already the `CompanionBar` above, mid-sentence, with its words arriving as they
 * are said.
 *
 * Each chip can be dismissed. That is the Sims part, and it is the reason the row is worth its
 * space at all — a queue you can only watch is a status readout, and a queue you can steer is a
 * control. Dismissing costs the pacing policy nothing: it is a statement about this remark, not
 * about how long the companion should wait.
 */
import { useValue } from 'tldraw'
import { InlineLoader } from 'generative-loaders'
import { cancelThought, companionQueue } from '@/companion/companionState'
import { caption, FIELD_INK, MONO, fieldTint, panelChrome } from '@/canvas/ui/theme'

export function CompanionQueue() {
	const queue = useValue(companionQueue)
	const cancel = useValue(cancelThought)

	// The head is the bar above — being spoken, or named by the hint that replaces it — so the
	// row is strictly what is behind it. Showing the head here too described one thought twice,
	// on two stacked lines, which is the crowding the bar was given the whole zone to avoid.
	const waiting = queue.slice(1)
	if (waiting.length === 0) return null

	return (
		<div
			// Same guard, same reason, as the bar's: the strip spans the top of the canvas, and a
			// click anywhere in it would otherwise clear the selection behind it.
			onPointerDown={(event) => event.stopPropagation()}
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				justifyContent: 'center',
				gap: 'var(--tl-space-2)',
				margin: '0 var(--tl-space-3)',
				minWidth: 0,
			}}
		>
			{waiting.map((thought) => (
				<div
					key={thought.id}
					// The gesture in full, since the chip itself only has room for the start of it.
					title={thought.gesture}
					style={{
						...panelChrome,
						display: 'inline-flex',
						alignItems: 'center',
						gap: 'var(--tl-space-2)',
						padding: '2px var(--tl-space-2) 2px var(--tl-space-3)',
						// The one still being thought about is the field's ink, like the hint it
						// replaces; the ones merely waiting their turn sit back.
						border: `1px solid ${fieldTint(thought.state === 'thinking' ? 0.4 : 0.15)}`,
						font: MONO,
						maxWidth: 180,
					}}
				>
					{thought.state === 'thinking' ? (
						// `aria-hidden` by default and left that way: the bar's hint is the live
						// region, and a row that announced every chip would talk over it.
						<InlineLoader variant="ripple" size={16} />
					) : (
						<span aria-hidden="true" style={{ color: FIELD_INK }}>
							✦
						</span>
					)}
					<span
						style={{
							...caption,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{thought.gesture}
					</span>
					<button
						type="button"
						title="Never mind this one"
						aria-label={`Dismiss: ${thought.gesture}`}
						disabled={!cancel}
						onClick={() => cancel?.(thought.id)}
						style={{
							all: 'unset',
							cursor: cancel ? 'pointer' : 'default',
							padding: '0 2px',
							color: 'var(--tl-color-text-3)',
							flexShrink: 0,
						}}
					>
						×
					</button>
				</div>
			))}
		</div>
	)
}
