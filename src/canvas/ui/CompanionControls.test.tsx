/**
 * @vitest-environment jsdom
 *
 * The two companion switches, rendered for real. Proves each checkbox reflects its atom
 * and writes back to it — the seam the orchestrator reads to decide whether to consult
 * the model and whether to speak.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompanionControls } from '@/canvas/ui/CompanionControls'
import { observationEnabled, voiceEnabled } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	observationEnabled.set(true)
	voiceEnabled.set(true)
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render() {
	act(() => root.render(<CompanionControls />))
}

function checkbox(labelText: string): HTMLInputElement {
	const label = [...container.querySelectorAll('label')].find((element) =>
		element.textContent?.includes(labelText)
	)
	return label!.querySelector('input') as HTMLInputElement
}

describe('CompanionControls', () => {
	it('reflects the current switch state', () => {
		voiceEnabled.set(false)
		render()

		expect(checkbox('observation').checked).toBe(true)
		expect(checkbox('Voice').checked).toBe(false)
	})

	it('turns observation off when toggled', () => {
		render()

		act(() => checkbox('observation').click())

		expect(observationEnabled.get()).toBe(false)
	})

	it('turns voice off when toggled', () => {
		render()

		act(() => checkbox('Voice').click())

		expect(voiceEnabled.get()).toBe(false)
	})
})
