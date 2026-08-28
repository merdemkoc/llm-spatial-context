/**
 * @vitest-environment jsdom
 *
 * The two companion switches, rendered for real. Proves each checkbox reflects its atom
 * and writes back to it — the seam the orchestrator reads to decide whether to consult
 * the model and whether to speak.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanionControls } from '@/canvas/ui/CompanionControls'
import {
	groupingSuggestion,
	observationEnabled,
	requestGrouping,
	voiceEnabled,
} from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	observationEnabled.set(true)
	voiceEnabled.set(true)
	groupingSuggestion.set(null)
	requestGrouping.set(() => {})
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	groupingSuggestion.set(null)
	requestGrouping.set(null)
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

function suggestButton(): HTMLButtonElement {
	const found = [...container.querySelectorAll('button')].find((element) =>
		element.textContent?.includes('Suggest a grouping')
	)
	expect(found, 'no "Suggest a grouping" button').toBeDefined()
	return found as HTMLButtonElement
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

	describe('the suggest-a-grouping button', () => {
		it('asks the companion for a grouping when clicked', () => {
			const request = vi.fn()
			requestGrouping.set(request)
			render()

			act(() => suggestButton().click())

			expect(request).toHaveBeenCalledTimes(1)
		})

		it('is disabled while observation is off', () => {
			observationEnabled.set(false)
			render()

			expect(suggestButton().disabled).toBe(true)
		})

		it('is disabled while a grouping is already pending', () => {
			groupingSuggestion.set({ generation: 1, members: ['a', 'b'], targets: [], rationale: 'x' })
			render()

			expect(suggestButton().disabled).toBe(true)
		})

		it('is disabled when no companion is mounted', () => {
			requestGrouping.set(null)
			render()

			expect(suggestButton().disabled).toBe(true)
		})
	})
})
