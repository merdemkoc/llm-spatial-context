/**
 * @vitest-environment jsdom
 *
 * The "✦ Agent…" hint. Proves it appears while the companion is working, names which of the
 * two jobs it is on, carries the motion that keeps a five-second wait from reading as a
 * hang, and is absent otherwise — the unobtrusive, transient status the spec asks for.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentThinkingIndicator } from '@/canvas/ui/AgentThinkingIndicator'
import { companionStage } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	companionStage.set('idle')
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render() {
	act(() => root.render(<AgentThinkingIndicator />))
}

describe('AgentThinkingIndicator', () => {
	it('shows the hint while the companion is thinking', () => {
		companionStage.set('observing')
		render()

		expect(container.textContent).toContain('thinking')
	})

	it('says it is finding a voice once the sentence exists', () => {
		// The second half of the wait is a different job, and about two seconds long. Saying
		// "thinking" through it would be both stale and indistinguishable from a hang.
		companionStage.set('composing')
		render()

		expect(container.textContent).toContain('finding a voice')
		expect(container.textContent).not.toContain('thinking')
	})

	it('moves, so five seconds of waiting does not read as a hang', () => {
		companionStage.set('observing')
		render()

		// The motion itself belongs to `generative-loaders`; what this pins is that the hint
		// still carries one, and that it stays out of the accessibility tree — the label
		// beside it is what the live region should announce.
		const loader = container.querySelector('.il-loader')
		expect(loader).not.toBeNull()
		expect(loader!.getAttribute('data-variant')).toBe('ripple')
		expect(loader!.getAttribute('aria-hidden')).toBe('true')
	})

	it('renders nothing when idle', () => {
		render()

		expect(container.textContent).toBe('')
	})
})
