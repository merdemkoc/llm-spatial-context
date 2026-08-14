/**
 * The companion's spoken-comment transcript.
 *
 * Styled after the event log, but where that shows raw spatial *events*, this shows the
 * AI's *interpretations* — the sentences it decided were worth saying, newest first. It
 * makes the demo legible before any audio plays and keeps the reasoning visible when
 * Voice is switched off. A view over the `companionTranscript` atom, holding no state.
 */
import { useValue } from 'tldraw'
import { companionTranscript } from '@/companion/companionState'
import { caption, readoutBox } from '@/canvas/ui/theme'

export function CompanionTranscriptPanel() {
	const transcript = useValue(companionTranscript)
	const newestFirst = [...transcript].reverse()

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tl-space-2)' }}>
			<span style={caption}>
				✦ Companion · {transcript.length} comment{transcript.length === 1 ? '' : 's'}
			</span>
			<div style={{ ...readoutBox, maxHeight: 220 }}>
				{newestFirst.length === 0 ? (
					<span style={caption}>
						Nothing said yet. Move ideas together, draw a <strong>Relation</strong>, or pull them
						apart, and the companion’s observations show up here.
					</span>
				) : (
					<ul
						style={{
							margin: 0,
							padding: 0,
							listStyle: 'none',
							display: 'flex',
							flexDirection: 'column',
							gap: 'var(--tl-space-2)',
						}}
					>
						{newestFirst.map((entry) => (
							<li key={`${entry.at}:${entry.comment}`}>{entry.comment}</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}
