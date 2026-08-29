/**
 * @vitest-environment jsdom
 *
 * Deciding the reflection's proposed ideas.
 *
 * The ghosts are inert; this panel is where they are kept or dropped — one at a time or all at
 * once. Adding calls the companion's commit handle (which stamps and places the note); dismissing
 * just drops the ghost.
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
import { IdeaControls } from '@/canvas/ui/IdeaControls'
import {
	commitIdeas,
	commitRelations,
	ideaSuggestions,
	relationSuggestions,
	type GhostIdea,
} from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

const IDEAS: GhostIdea[] = [
	{ id: 'idea-0', text: 'time to first value', kind: 'idea', x: 600, y: 0 },
	{ id: 'idea-1', text: 'what makes teams stick?', kind: 'question', x: 600, y: 200 },
]

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	ideaSuggestions.set([])
	relationSuggestions.set([])
	commitIdeas.set(null)
	commitRelations.set(null)

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
	ideaSuggestions.set([])
	relationSuggestions.set([])
	commitIdeas.set(null)
	commitRelations.set(null)
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<IdeaControls />
			</EditorContext.Provider>
		)
	})
}

function propose() {
	act(() => ideaSuggestions.set(IDEAS))
}

function row(id: string): HTMLElement {
	const found = container.querySelector<HTMLElement>(`[data-idea-row="${id}"]`)
	expect(found, `no row for ${id}`).toBeTruthy()
	return found!
}

function button(text: string): HTMLButtonElement {
	const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
	expect(found, `no "${text}" button`).toBeTruthy()
	return found as HTMLButtonElement
}

describe('IdeaControls', () => {
	it('renders nothing when no ideas are pending', () => {
		render()
		expect(container.querySelector('button')).toBeNull()
	})

	it('lists each proposed idea', () => {
		render()
		propose()
		expect(container.textContent).toContain('time to first value')
		expect(container.textContent).toContain('what makes teams stick?')
	})

	it('commits every idea when Add all is clicked', () => {
		const commit = vi.fn()
		commitIdeas.set(commit)
		render()
		propose()

		act(() => button('Add all').click())

		expect(commit).toHaveBeenCalledWith(['idea-0', 'idea-1'])
	})

	it('clears every ghost when Dismiss all is clicked', () => {
		render()
		propose()

		act(() => button('Dismiss all').click())

		expect(ideaSuggestions.get()).toEqual([])
	})

	it('commits a single idea from its row', () => {
		const commit = vi.fn()
		commitIdeas.set(commit)
		render()
		propose()

		act(() => row('idea-0').querySelector<HTMLButtonElement>('[data-idea-add]')!.click())

		expect(commit).toHaveBeenCalledWith(['idea-0'])
	})

	it('drops a single ghost from its row without committing', () => {
		const commit = vi.fn()
		commitIdeas.set(commit)
		render()
		propose()

		act(() => row('idea-1').querySelector<HTMLButtonElement>('[data-idea-dismiss]')!.click())

		expect(ideaSuggestions.get().map((i) => i.id)).toEqual(['idea-0'])
		expect(commit).not.toHaveBeenCalled()
	})

	it('draws a proposed arrow from its row', () => {
		const commit = vi.fn()
		commitRelations.set(commit)
		render()
		act(() => relationSuggestions.set([{ id: 'rel-0', from: 'a', to: 'b', label: 'leads to' }]))

		act(() =>
			container
				.querySelector<HTMLButtonElement>('[data-relation-row="rel-0"] [data-relation-add]')!
				.click()
		)

		expect(commit).toHaveBeenCalledWith(['rel-0'])
	})

	it('Add all commits both the ideas and the arrows', () => {
		const addIdeas = vi.fn()
		const addRelations = vi.fn()
		commitIdeas.set(addIdeas)
		commitRelations.set(addRelations)
		render()
		propose()
		act(() => relationSuggestions.set([{ id: 'rel-0', from: 'a', to: 'b' }]))

		act(() => button('Add all').click())

		expect(addIdeas).toHaveBeenCalledWith(['idea-0', 'idea-1'])
		expect(addRelations).toHaveBeenCalledWith(['rel-0'])
	})
})
