/**
 * @vitest-environment jsdom
 *
 * Influence scores, on the notes they describe.
 *
 * The load-bearing assertion is that the badge shows the *document's* numbers.
 * `spatialContext` is already rounded, and the Inspector reads from it so the
 * table and the JSON can't round differently — a badge that recomputed would be a
 * third answer with no way to tell which of the three was right.
 *
 * Radii are chosen so the two directions of a pair are visibly different: that
 * asymmetry is the reason both are shown.
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
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { ContextualFieldOverlay } from '@/canvas/ui/ContextualFieldOverlay'
import { showContextualFields } from '@/canvas/ui/contextualFieldVisibility'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	showContextualFields.set(true)

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
	showContextualFields.set(true)
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<ContextualFieldOverlay />
			</EditorContext.Provider>
		)
	})
}

function createPostIt(id: string, x: number, y: number, radius?: number, rotation?: number) {
	const node = createPostItNode({ id, x, y, radius, rotation })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

function select(...ids: string[]) {
	act(() => {
		editor.select(...ids.map(nodeIdToShapeId))
	})
}

function badges() {
	return [...container.querySelectorAll<HTMLElement>('[data-influence-badge]')]
}

function badgeFor(id: string) {
	const found = badges().find((element) => element.dataset.influenceBadge === id)
	expect(found, `no influence badge for ${id}`).toBeDefined()

	return found!
}

function badgeIds() {
	return badges()
		.map((element) => element.dataset.influenceBadge!)
		.sort()
}

/** The document's own number for a directed pair, formatted as the UI formats it. */
function documented(source: string, target: string) {
	const row = getCanvasDocument(editor).spatialContext.influences.find(
		(influence) => influence.source === source && influence.target === target
	)
	expect(row, `no influence row for ${source} → ${target}`).toBeDefined()

	return { influence: row!.influence.toFixed(3), distance: String(row!.distance) }
}

describe('influence badges', () => {
	it('badges a node the selection reaches', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		select('a')

		expect(badgeIds()).toEqual(['b'])
	})

	it('badges nothing while nothing is selected', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		expect(badges()).toEqual([])
	})

	it('never badges the selected node itself', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		select('a')

		expect(badgeIds()).not.toContain('a')
	})

	it('leaves a node out of range in both directions unbadged', () => {
		createPostIt('a', 0, 0, 300)
		createPostIt('far', 5000, 0, 300)
		render()

		select('a')

		expect(badges()).toEqual([])
	})

	/**
	 * The whole reason both directions are shown: the pair is 400 units apart
	 * either way, but `a` reaches further, so it influences `b` more than `b`
	 * influences `a`.
	 */
	it('shows both directions, and they differ when the radii differ', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 500)
		render()

		select('a')

		const badge = badgeFor('b')
		const outgoing = documented('a', 'b')
		const incoming = documented('b', 'a')

		expect(outgoing.influence).not.toBe(incoming.influence)
		expect(badge.textContent).toContain(outgoing.influence)
		expect(badge.textContent).toContain(incoming.influence)
	})

	it('shows the document’s numbers rather than its own', () => {
		createPostIt('a', 0, 0, 777)
		createPostIt('b', 313, 97, 421)
		render()

		select('a')

		expect(badgeFor('b').textContent).toContain(documented('a', 'b').influence)
		expect(badgeFor('b').textContent).toContain(documented('b', 'a').influence)
	})

	/**
	 * A node with no radius of its own exerts nothing, but things still reach it —
	 * the case an outgoing-only reading would have shown as an empty canvas.
	 */
	it('badges a fieldless selection with what reaches it', () => {
		createPostIt('bare', 0, 0)
		createPostIt('reacher', 400, 0, 600)
		render()

		select('bare')

		expect(badgeIds()).toEqual(['reacher'])

		const badge = badgeFor('reacher')
		expect(badge.textContent).toContain(documented('reacher', 'bare').influence)
		// Outgoing is genuinely zero: `bare` has no field to reach with.
		expect(badge.textContent).toContain('0.000')
	})

	/** Distance is symmetric, so repeating it per direction would be noise. */
	it('states the distance once', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		select('a')

		const { distance } = documented('a', 'b')
		const occurrences = badgeFor('b').textContent!.split(distance).length - 1

		expect(occurrences).toBe(1)
	})

	/** `→` and `←` are relative to *the* selected node; two selections have no referent. */
	it('drops badges when more than one node is selected', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		select('a', 'b')

		expect(badges()).toEqual([])
	})

	it('drops badges when the switch is off', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		showContextualFields.set(false)
		render()

		select('a')

		expect(badges()).toEqual([])
	})

	/**
	 * Circles are world-space objects and should grow with the canvas. A label that
	 * grows becomes a billboard, so badges counter-scale to a constant screen size.
	 */
	it('counter-scales so the text stays one size on screen', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		select('a')
		const atDefaultZoom = badgeFor('b').style.transform

		act(() => {
			editor.setCamera({ x: 0, y: 0, z: 4 })
		})

		expect(badgeFor('b').style.transform).not.toBe(atDefaultZoom)
		expect(badgeFor('b').style.transform).toContain('scale(0.25)')
	})

	it('never intercepts a pointer aimed at the canvas', () => {
		createPostIt('a', 0, 0, 600)
		createPostIt('b', 400, 0, 250)
		render()

		select('a')

		expect(badgeFor('b').style.pointerEvents).toBe('none')
	})
})
