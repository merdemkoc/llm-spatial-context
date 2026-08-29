/**
 * @vitest-environment jsdom
 *
 * The agent's proposed arrows, drawn as ghosts.
 *
 * A pending reflection can propose arrows between existing notes, and new-note ideas that connect
 * to an existing note. Both preview as dashed agent-tinted arrows. What matters here: one per
 * proposed link, drawn from the right ends, skipping any whose endpoint is gone, and inert.
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
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { RelationGhostOverlay } from '@/canvas/ui/RelationGhostOverlay'
import { ideaSuggestions, relationSuggestions } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	relationSuggestions.set([])
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
	relationSuggestions.set([])
	ideaSuggestions.set([])
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<RelationGhostOverlay />
			</EditorContext.Provider>
		)
	})
}

function createPostIt(id: string, x = 0, y = 0) {
	const node = createPostItNode({ id, x, y })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

const arrows = () => [...container.querySelectorAll<SVGElement>('[data-ghost-arrow]')]

describe('RelationGhostOverlay', () => {
	it('renders nothing when there are no proposed links', () => {
		createPostIt('a')
		render()
		expect(arrows()).toEqual([])
	})

	it('draws an arrow for a proposed relation between existing notes', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 800, 0)
		render()
		act(() => relationSuggestions.set([{ id: 'rel-0', from: 'a', to: 'b', label: 'leads to' }]))

		expect(arrows()).toHaveLength(1)
	})

	it('draws an arrow from a new idea to the note it connects to', () => {
		createPostIt('a', 0, 0)
		render()
		act(() =>
			ideaSuggestions.set([
				{ id: 'idea-0', text: 'metric', kind: 'idea', x: 800, y: 0, connectTo: 'a', connectLabel: 'measures' },
				{ id: 'idea-1', text: 'lonely', kind: 'idea', x: 800, y: 300 },
			])
		)

		// Only the connected idea draws an arrow.
		expect(arrows()).toHaveLength(1)
	})

	it('skips a proposed relation whose endpoint is gone', () => {
		createPostIt('a', 0, 0)
		render()
		act(() => relationSuggestions.set([{ id: 'rel-0', from: 'a', to: 'gone' }]))

		expect(arrows()).toEqual([])
	})

	it('never intercepts a pointer aimed at the canvas', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 800, 0)
		render()
		act(() => relationSuggestions.set([{ id: 'rel-0', from: 'a', to: 'b' }]))

		const svg = container.querySelector<SVGElement>('svg')!
		expect(svg.style.pointerEvents).toBe('none')
	})
})
