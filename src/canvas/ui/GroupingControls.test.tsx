/**
 * @vitest-environment jsdom
 *
 * The accept / dismiss controls for a pending grouping.
 *
 * These are the only pointer-enabled part of the proposal — the ghost itself is inert — so
 * what matters is that they appear only while a grouping is pending, that Accept calls the
 * companion's published handle (which commits and affirms), and that Dismiss simply clears
 * the proposal.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultTools,
	Editor,
	EditorContext,
} from 'tldraw'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { GroupingControls } from '@/canvas/ui/GroupingControls'
import { acceptGrouping, groupingSuggestion } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	groupingSuggestion.set(null)
	acceptGrouping.set(null)

	editor = new Editor({
		store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [...defaultTools],
		getContainer: () => document.createElement('div'),
	})

	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	groupingSuggestion.set(null)
	acceptGrouping.set(null)
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<GroupingControls />
			</EditorContext.Provider>
		)
	})
}

function propose() {
	act(() =>
		groupingSuggestion.set({
			members: ['a', 'b'],
			targets: [
				{ id: 'a', x: 0, y: 0 },
				{ id: 'b', x: 240, y: 0 },
			],
			rationale: 'These two belong together.',
		})
	)
}

function button(text: string): HTMLButtonElement {
	const found = [...container.querySelectorAll('button')].find((element) =>
		element.textContent?.includes(text)
	)
	expect(found, `no "${text}" button`).toBeDefined()
	return found as HTMLButtonElement
}

describe('GroupingControls', () => {
	it('renders nothing when no grouping is pending', () => {
		render()
		expect(container.querySelector('button')).toBeNull()
	})

	it('shows the rationale while a grouping is pending', () => {
		render()
		propose()
		expect(container.textContent).toContain('These two belong together.')
	})

	it('calls the accept handle when Accept is clicked', () => {
		const accept = vi.fn()
		acceptGrouping.set(accept)
		render()
		propose()

		act(() => button('Accept').click())

		expect(accept).toHaveBeenCalledTimes(1)
	})

	it('clears the proposal when Dismiss is clicked', () => {
		render()
		propose()

		act(() => button('Dismiss').click())

		expect(groupingSuggestion.get()).toBeNull()
	})

	it('is pointer-enabled, unlike the inert ghost', () => {
		render()
		propose()

		const panel = button('Accept').closest('[data-grouping-controls]') as HTMLElement
		expect(panel.style.pointerEvents).toBe('all')
	})
})
