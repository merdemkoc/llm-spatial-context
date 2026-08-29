/**
 * @vitest-environment jsdom
 *
 * The reflection's proposed ideas, drawn as ghosts.
 *
 * Each pending idea shows as a faint agent-accented note where it would land, carrying its
 * text. What matters here: one per idea, placed on its spot, carrying its words, and never
 * intercepting a pointer aimed at the canvas.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultTools,
	Editor,
	EditorContext,
} from 'tldraw'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { IdeaGhostOverlay } from '@/canvas/ui/IdeaGhostOverlay'
import { ideaSuggestions, type GhostIdea } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	ideaSuggestions.set([])

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
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<IdeaGhostOverlay />
			</EditorContext.Provider>
		)
	})
}

function propose(ideas: GhostIdea[]) {
	act(() => ideaSuggestions.set(ideas))
}

function ghosts() {
	return [...container.querySelectorAll<HTMLElement>('[data-idea-ghost]')]
}

describe('IdeaGhostOverlay', () => {
	it('renders nothing when there are no proposed ideas', () => {
		render()
		expect(ghosts()).toEqual([])
	})

	it('draws one ghost per idea, carrying its text', () => {
		render()
		propose([
			{ id: 'idea-0', text: 'time to first value', kind: 'idea', x: 600, y: 0 },
			{ id: 'idea-1', text: 'what makes teams stick?', kind: 'question', x: 600, y: 200 },
		])

		expect(ghosts().map((e) => e.dataset.ideaGhost)).toEqual(['idea-0', 'idea-1'])
		expect(container.textContent).toContain('time to first value')
		expect(container.textContent).toContain('what makes teams stick?')
	})

	it('places each ghost on its spot', () => {
		render()
		propose([{ id: 'idea-0', text: 'x', kind: 'idea', x: 640, y: 120 }])

		const ghost = ghosts()[0]
		expect(ghost.style.left).toBe('640px')
		expect(ghost.style.top).toBe('120px')
	})

	it('never intercepts a pointer aimed at the canvas', () => {
		render()
		propose([{ id: 'idea-0', text: 'x', kind: 'idea', x: 0, y: 0 }])

		expect(ghosts()[0].style.pointerEvents).toBe('none')
	})
})
