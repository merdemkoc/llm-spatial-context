/**
 * The "✦ Agent thinking…" hint.
 *
 * Shown only while the orchestrator is awaiting the model's verdict — minimal,
 * unobtrusive, and clearly the AI's, per MVP-2 §6. It renders nothing when idle, so it
 * never occupies space in the stack unless something is actually happening.
 */
import { useValue } from 'tldraw'
import { companionThinking } from '@/companion/companionState'

export function AgentThinkingIndicator() {
	const thinking = useValue(companionThinking)
	if (!thinking) return null

	return (
		<div
			aria-live="polite"
			style={{
				padding: '4px 10px',
				borderRadius: 999,
				border: '1px solid rgba(91, 91, 214, 0.4)',
				background: 'var(--tl-color-panel, #fff)',
				color: '#5B5BD6',
				boxShadow: '0 1px 4px rgba(0, 0, 0, 0.1)',
				font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
				pointerEvents: 'none',
				userSelect: 'none',
			}}
		>
			✦ Agent thinking…
		</div>
	)
}
