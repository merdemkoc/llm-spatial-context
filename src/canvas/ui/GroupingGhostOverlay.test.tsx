/**
 * @vitest-environment jsdom
 *
 * The grouping ghost, rendered for real against a real editor.
 *
 * A pending grouping shows each member highlighted where it is and a faint ghost where it
 * would land. What matters here is that there is one of each per member, that the ghost sits
 * on its target, that a member gone from the canvas is skipped, and that none of it ever
 * intercepts a pointer aimed at the canvas.
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
import { GroupingGhostOverlay } from '@/canvas/ui/GroupingGhostOverlay'
import { groupingSuggestion } from '@/companion/companionState'

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
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<GroupingGhostOverlay />
			</EditorContext.Provider>
		)
	})
}

function createPostIt(id: string, x = 0, y = 0) {
	const node = createPostItNode({ id, x, y })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

function ghosts() {
	return [...container.querySelectorAll<HTMLElement>('[data-grouping-ghost]')]
}
function highlights() {
	return [...container.querySelectorAll<HTMLElement>('[data-grouping-member]')]
}

function propose(members: string[], targets: { id: string; x: number; y: number }[]) {
	act(() => groupingSuggestion.set({ members, targets, rationale: 'grouped' }))
}

describe('GroupingGhostOverlay', () => {
	it('renders nothing when no grouping is pending', () => {
		createPostIt('a')
		render()

		expect(ghosts()).toEqual([])
		expect(highlights()).toEqual([])
	})

	it('draws a highlight and a ghost for each member', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 1000, 0)
		render()
		propose(
			['a', 'b'],
			[
				{ id: 'a', x: 400, y: 0 },
				{ id: 'b', x: 640, y: 0 },
			]
		)

		expect(highlights().map((e) => e.dataset.groupingMember).sort()).toEqual(['a', 'b'])
		expect(ghosts().map((e) => e.dataset.groupingGhost).sort()).toEqual(['a', 'b'])
	})

	it('places each ghost on its target', () => {
		createPostIt('a', 0, 0)
		render()
		propose(['a', 'b'], [{ id: 'a', x: 500, y: 300 }])

		const ghost = ghosts().find((e) => e.dataset.groupingGhost === 'a')!
		expect(ghost.style.left).toBe('500px')
		expect(ghost.style.top).toBe('300px')
	})

	it('skips a member that is no longer on the canvas', () => {
		createPostIt('a', 0, 0)
		render()
		propose(
			['a', 'gone'],
			[
				{ id: 'a', x: 100, y: 0 },
				{ id: 'gone', x: 200, y: 0 },
			]
		)

		expect(ghosts().map((e) => e.dataset.groupingGhost)).toEqual(['a'])
		expect(highlights().map((e) => e.dataset.groupingMember)).toEqual(['a'])
	})

	it('never intercepts a pointer aimed at the canvas', () => {
		createPostIt('a', 0, 0)
		render()
		propose(['a', 'b'], [{ id: 'a', x: 100, y: 0 }])

		expect(ghosts()[0].style.pointerEvents).toBe('none')
		expect(highlights()[0].style.pointerEvents).toBe('none')
	})
})
