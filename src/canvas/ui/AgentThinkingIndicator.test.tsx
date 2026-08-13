/**
 * @vitest-environment jsdom
 *
 * The "✦ Agent thinking…" hint. Proves it appears while the orchestrator is awaiting the
 * model and is absent otherwise — the unobtrusive, transient status the spec asks for.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentThinkingIndicator } from '@/canvas/ui/AgentThinkingIndicator'
import { companionThinking } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	companionThinking.set(false)
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
		companionThinking.set(true)
		render()

		expect(container.textContent).toContain('thinking')
	})

	it('renders nothing when idle', () => {
		render()

		expect(container.textContent).toBe('')
	})
})
