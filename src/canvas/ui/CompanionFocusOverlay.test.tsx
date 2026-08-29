/**
 * @vitest-environment jsdom
 *
 * The companion's spotlight, drawn.
 *
 * While the companion speaks, the notes its remark is about are highlighted — a region
 * enclosing them, and a ring on each. What matters here: it appears only when there is a focus,
 * rings each focused note, skips ids no longer on the canvas, and never intercepts a pointer.
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
import { CompanionFocusOverlay } from '@/canvas/ui/CompanionFocusOverlay'
import { companionFocus } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	companionFocus.set([])

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
	companionFocus.set([])
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<CompanionFocusOverlay />
			</EditorContext.Provider>
		)
	})
}

function createPostIt(id: string, x = 0, y = 0) {
	const node = createPostItNode({ id, x, y })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

const focusOn = (ids: string[]) => act(() => companionFocus.set(ids))
const rings = () => [...container.querySelectorAll<HTMLElement>('[data-companion-focus]')]
const region = () => container.querySelector<HTMLElement>('[data-companion-focus-region]')

describe('CompanionFocusOverlay', () => {
	it('renders nothing when there is no focus', () => {
		createPostIt('a')
		render()
		expect(region()).toBeNull()
		expect(rings()).toEqual([])
	})

	it('rings each focused note and draws a region around them', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 800, 0)
		render()
		focusOn(['a', 'b'])

		expect(rings().map((e) => e.dataset.companionFocus).sort()).toEqual(['a', 'b'])
		expect(region()).toBeTruthy()
	})

	it('skips a focus id that is no longer on the canvas', () => {
		createPostIt('a', 0, 0)
		render()
		focusOn(['a', 'gone'])

		expect(rings().map((e) => e.dataset.companionFocus)).toEqual(['a'])
	})

	it('never intercepts a pointer aimed at the canvas', () => {
		createPostIt('a', 0, 0)
		render()
		focusOn(['a'])

		expect(region()!.style.pointerEvents).toBe('none')
		expect(rings()[0].style.pointerEvents).toBe('none')
	})
})
