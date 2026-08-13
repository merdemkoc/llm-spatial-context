/**
 * @vitest-environment jsdom
 *
 * The companion's spoken-comment transcript, rendered for real. Proves comments show
 * newest-first and that an empty transcript shows a placeholder — the legible-without-
 * audio view of what the AI has said.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompanionTranscriptPanel } from '@/canvas/ui/CompanionTranscriptPanel'
import { companionTranscript } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	companionTranscript.set([])
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render() {
	act(() => root.render(<CompanionTranscriptPanel />))
}

describe('CompanionTranscriptPanel', () => {
	it('shows recent comments, newest first', () => {
		companionTranscript.set([
			{ comment: 'first observation', at: 1 },
			{ comment: 'second observation', at: 2 },
		])
		render()

		const text = container.textContent ?? ''
		expect(text).toContain('first observation')
		expect(text).toContain('second observation')
		expect(text.indexOf('second observation')).toBeLessThan(text.indexOf('first observation'))
	})

	it('shows a placeholder when nothing has been said', () => {
		render()

		expect(container.textContent).toMatch(/nothing/i)
	})
})
