/**
 * What the companion is saying.
 *
 * The companion is the only part of this UI that speaks unprompted, so it is the only
 * part that earns permanent space — and `config.tsx` gives it the top-centre zone, which
 * tldraw leaves empty. That placement is a claim about what it is: the app's voice,
 * narrating the canvas, not another readout competing with the JSON for the corner.
 *
 * Three states, one chip:
 *   nothing said yet → a resting label, so there is something to click
 *   model consulted  → the thinking indicator, unchanged
 *   has spoken       → the latest sentence, with the full transcript one click away
 */
import { useState, type CSSProperties } from 'react'
import { TextLoader } from 'generative-loaders'
import {
	TldrawUiButton,
	TldrawUiPopover,
	TldrawUiPopoverContent,
	TldrawUiPopoverTrigger,
	useValue,
} from 'tldraw'
import { companionStage, companionTranscript, companionUtterance } from '@/companion/companionState'
import { spokenPrefix } from '@/companion/reveal'
import { AgentThinkingIndicator } from '@/canvas/ui/AgentThinkingIndicator'
import { CompanionTranscriptPanel } from '@/canvas/ui/CompanionTranscriptPanel'
import { MONO, MONO_FAMILY, caption, panelChrome } from '@/canvas/ui/theme'

/**
 * The measure a remark is set to.
 *
 * The minimum is what stops a short sentence from being squeezed into a sliver by the
 * flex row; the maximum is what stops a long one from stretching into a single line the
 * eye has to track across the whole canvas. Both are in play because the top-centre zone
 * squeezes itself when the side panels grow.
 */
const SENTENCE_MIN_WIDTH = 240
const SENTENCE_MAX_WIDTH = 360

export function CompanionBar() {
	const transcript = useValue(companionTranscript)
	const stage = useValue(companionStage)
	const utterance = useValue(companionUtterance)

	/**
	 * While a clip is playing the bar shows only what has been said so far; between clips it
	 * shows the newest remark whole. Both read the same sentence — the utterance is the
	 * transcript's last entry, mid-delivery — so the text never jumps when playback ends.
	 */
	const spoken = utterance ? spokenPrefix(utterance.comment, utterance.fraction) : undefined
	const latest = spoken ?? transcript.at(-1)?.comment

	// Mirrored so the transcript is built only once it is asked for: the popover's content
	// resolves the editor container as soon as it exists in the tree, open or not.
	const [isShowingTranscript, setIsShowingTranscript] = useState(false)

	return (
		<div
			// Guarding pointer-down here rather than on the chip: the container is the whole
			// centred strip, and a click anywhere in it would otherwise clear the selection.
			onPointerDown={(event) => event.stopPropagation()}
			style={{
				display: 'flex',
				justifyContent: 'center',
				margin: 'var(--tl-space-3)',
				minWidth: 0,
			}}
		>
			{/* The thinking indicator replaces the chip rather than joining it: two lines
				    about the same companion, stacked, was the old corner problem in miniature. */}
			{stage !== 'idle' ? (
				<AgentThinkingIndicator />
			) : (
				<TldrawUiPopover id="companion-transcript" onOpenChange={setIsShowingTranscript}>
					<TldrawUiPopoverTrigger>
						<TldrawUiButton
							type="normal"
							title="What the companion has said"
							style={{
								...panelChrome,
								font: MONO,
								maxWidth: '100%',
								gap: 'var(--tl-space-3)',
								justifyContent: 'flex-start',
								// A remark is a sentence or two, so when there is one the chip stops
								// being a 40px label row and becomes a block that can grow. The ✦ moves
								// to the top so it sits with the first line rather than floating in the
								// middle of the paragraph.
								...(latest
									? {
											height: 'auto',
											minHeight: 40,
											alignItems: 'flex-start',
											padding: 'var(--tl-space-3) var(--tl-space-4)',
										}
									: null),
							}}
						>
							<span aria-hidden="true" style={{ color: 'var(--tl-color-text-3)' }}>
								✦
							</span>
							{latest ? (
								// Wrapped rather than ellipsised. Given the whole width the sentence
								// renders as one clipped line, which reads as a fragment; held to a
								// measure it reads as something said.
								//
								// No line clamp. A clamp froze the text at whatever line it filled while
								// the voice carried on past it — the words stopped arriving but the
								// sound didn't, which is worse than a chip that grows. The remark is
								// one or two sentences by construction (the prompt asks for that, and
								// `MAX_SPEAK_CHARS` caps it), so growing is bounded in practice.
								<span
									style={
										{
											minWidth: SENTENCE_MIN_WIDTH,
											maxWidth: SENTENCE_MAX_WIDTH,
											textAlign: 'left',
											whiteSpace: 'normal',
											// The loader sets `font-family: var(--tl-font)`, whose default is a
											// sans stack — which would put this one sentence in a different face
											// from every other readout. Pointed at ours instead. (The name is the
											// package's, and only *looks* like tldraw's `--tl-*`: tldraw suffixes
											// all of its own, `--tl-font-mono` and friends, so nothing collides.)
											'--tl-font': MONO_FAMILY,
										} as CSSProperties
									}
								>
									{/* `TextLoader` animates only the characters that are new since its last
									    render — it compares the incoming text against what it already
									    showed. Our prefix grows by a word at a time and always extends what
									    came before, so each word cascades in as the voice reaches it and
									    nothing already on screen re-animates. */}
									{/* `currentColor` because the loader's own default is a literal `#111111`,
									    which would stay near-black on a dark panel. */}
									<TextLoader text={latest} variant="cascade" color="currentColor" />
								</span>
							) : (
								<span style={caption}>Companion</span>
							)}
							{transcript.length > 1 && (
								<span style={{ ...caption, flexShrink: 0 }}>· {transcript.length}</span>
							)}
						</TldrawUiButton>
					</TldrawUiPopoverTrigger>
					{isShowingTranscript && (
						<TldrawUiPopoverContent side="bottom" align="center">
							<div
								// The transcript scrolls, so its wheel events must not reach the canvas —
								// otherwise reading back what the companion said zooms the drawing.
								onWheel={(event) => event.stopPropagation()}
								style={{ width: 320, padding: 'var(--tl-space-4)', font: MONO }}
							>
								<CompanionTranscriptPanel />
							</div>
						</TldrawUiPopoverContent>
					)}
				</TldrawUiPopover>
			)}
		</div>
	)
}
