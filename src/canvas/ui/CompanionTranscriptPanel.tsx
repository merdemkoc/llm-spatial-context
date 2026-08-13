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

export function CompanionTranscriptPanel() {
	const transcript = useValue(companionTranscript)
	const newestFirst = [...transcript].reverse()

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<span style={{ opacity: 0.7, font: 'inherit' }}>
				✦ Companion · {transcript.length} comment{transcript.length === 1 ? '' : 's'}
			</span>
			<div style={preStyle}>
				{newestFirst.length === 0 ? (
					<span style={{ opacity: 0.6 }}>
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
							gap: 6,
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

const preStyle: React.CSSProperties = {
	margin: 0,
	padding: 8,
	maxHeight: 160,
	overflow: 'auto',
	borderRadius: 4,
	border: '1px solid rgba(0, 0, 0, 0.1)',
	background: 'var(--tl-color-muted-2, #f9f9f9)',
	font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
}
