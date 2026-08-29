/**
 * @vitest-environment jsdom
 *
 * The chip row, rendered for real. What it has to get right is small but easy to get wrong:
 * show what is still to come, leave out what is already being said, and put a working dismiss
 * on each one.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanionQueue } from '@/canvas/ui/CompanionQueue'
import { cancelThought, companionQueue } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	// Module-scope singletons, shared across every test in the file.
	companionQueue.set([])
	cancelThought.set(null)
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render() {
	act(() => root.render(<CompanionQueue />))
}

const chips = () => [...container.querySelectorAll('[title]')].filter((el) => el.tagName === 'DIV')

describe('CompanionQueue', () => {
	it('takes no space when there is no backlog', () => {
		render()

		expect(container.textContent).toBe('')
	})

	it('names each gesture waiting behind the one in hand', () => {
		companionQueue.set([
			{ id: 1, gesture: 'moved “Pricing”', state: 'speaking' },
			{ id: 2, gesture: 'linked “SSO” → “Auth”', state: 'ready' },
			{ id: 3, gesture: 'added “Billing”', state: 'thinking' },
		])
		render()

		expect(chips()).toHaveLength(2)
		expect(container.textContent).toContain('linked “SSO” → “Auth”')
		expect(container.textContent).toContain('added “Billing”')
	})

	it('leaves out the head, because the bar above is already about it', () => {
		// Whether it is being spoken or still being thought about, the head has the bar and the
		// hint. A chip for it too would describe one thought twice, on two stacked lines.
		companionQueue.set([{ id: 1, gesture: 'moved “Pricing”', state: 'thinking' }])
		render()

		expect(container.textContent).toBe('')
	})

	it('dismisses the thought whose × is clicked', () => {
		const cancel = vi.fn()
		cancelThought.set(cancel)
		companionQueue.set([
			{ id: 6, gesture: 'moved “Pricing”', state: 'speaking' },
			{ id: 7, gesture: 'added “SSO”', state: 'ready' },
			{ id: 8, gesture: 'resized “Auth”', state: 'thinking' },
		])
		render()

		const dismiss = [...container.querySelectorAll('button')]
		act(() => dismiss[1].click())

		expect(cancel).toHaveBeenCalledWith(8)
	})

	it('cannot dismiss anything while no companion is mounted', () => {
		companionQueue.set([
			{ id: 1, gesture: 'moved “Pricing”', state: 'speaking' },
			{ id: 2, gesture: 'added “SSO”', state: 'ready' },
		])
		render()

		expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true)
	})

	it('keeps a click off the canvas behind it', () => {
		// The strip spans the top of the canvas; without this a click on a chip would land as a
		// click on the board and clear the selection.
		companionQueue.set([
			{ id: 1, gesture: 'moved “Pricing”', state: 'speaking' },
			{ id: 2, gesture: 'added “SSO”', state: 'ready' },
		])
		render()

		// Listened for above React's root, since that is where the guard has to bite: React
		// delegates to the root container, so anything past it is the canvas.
		const reachedTheCanvas = vi.fn()
		document.body.addEventListener('pointerdown', reachedTheCanvas)
		const row = container.firstElementChild as HTMLElement
		act(() => {
			row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
		})
		document.body.removeEventListener('pointerdown', reachedTheCanvas)

		expect(reachedTheCanvas).not.toHaveBeenCalled()
	})
})
