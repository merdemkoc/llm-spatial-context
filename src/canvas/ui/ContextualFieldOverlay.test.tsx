/**
 * @vitest-environment jsdom
 *
 * The contextual-field overlay, rendered for real against a real editor.
 *
 * What matters here is that the picture agrees with the arithmetic. The circle
 * has to sit on `nodeCenter`, which is rotation-aware — an overlay drawn from
 * `x + width / 2` would look right for every unrotated note and quietly lie
 * about every rotated one, which is worse than not drawing it.
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
import { createPostItNode, nodeCenter, type CanvasNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
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

function createPostIt(id: string, x = 0, y = 0, radius?: number, rotation?: number): CanvasNode {
	const node = createPostItNode({ id, x, y, radius, rotation })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })

	return node
}

function circles() {
	return [...container.querySelectorAll<HTMLElement>('[data-contextual-field]')]
}

function circleFor(id: string) {
	const found = circles().find((element) => element.dataset.contextualField === id)
	expect(found, `no field circle for ${id}`).toBeDefined()

	return found!
}

describe('ContextualFieldOverlay', () => {
	it('draws a circle for a node that has a field', () => {
		createPostIt('a', 0, 0, 500)
		render()

		expect(circles()).toHaveLength(1)
	})

	it('draws nothing for a node with no field', () => {
		createPostIt('a', 0, 0)
		render()

		expect(circles()).toEqual([])
	})

	/**
	 * A radius of `0` is a legitimate state meaning "reaches nowhere", and the
	 * influence maths already treats it as such. A zero-size circle would be noise.
	 */
	it('draws nothing for a field that reaches nowhere', () => {
		createPostIt('a', 0, 0, 0)
		render()

		expect(circles()).toEqual([])
	})

	it('spans the diameter of the field, centred on the node', () => {
		createPostIt('a', 300, 200, 500)
		render()

		const circle = circleFor('a')

		// The node's centre is (420, 280); a 500 radius puts the box at (-80, -220).
		expect(circle.style.left).toBe('-80px')
		expect(circle.style.top).toBe('-220px')
		expect(circle.style.width).toBe('1000px')
		expect(circle.style.height).toBe('1000px')
	})

	/**
	 * The claim that makes the overlay trustworthy: rotation is applied about the
	 * top-left corner, so the centre is not `x + width / 2`.
	 */
	it('centres a rotated node’s circle on nodeCenter, not its box midpoint', () => {
		const node = createPostIt('a', 300, 200, 400, Math.PI / 2)
		render()

		const circle = circleFor('a')
		const center = nodeCenter(node)

		expect(circle.style.left).toBe(`${center.x - 400}px`)
		expect(circle.style.top).toBe(`${center.y - 400}px`)

		// Would be the answer if the midpoint were taken naively.
		expect(circle.style.left).not.toBe(`${300 + 120 - 400}px`)
	})

	it('draws one circle per node with a field', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 900, 0, 250)
		createPostIt('c', 1800, 0)
		render()

		expect(
			circles()
				.map((element) => element.dataset.contextualField)
				.sort()
		).toEqual(['a', 'b'])
	})

	it('never intercepts a pointer aimed at the canvas', () => {
		createPostIt('a', 0, 0, 500)
		render()

		expect(circleFor('a').style.pointerEvents).toBe('none')
	})

	it('draws nothing while the overlay is switched off', () => {
		createPostIt('a', 0, 0, 500)
		showContextualFields.set(false)
		render()

		expect(circles()).toEqual([])
	})

	it('comes back when the switch is turned on again', () => {
		createPostIt('a', 0, 0, 500)
		showContextualFields.set(false)
		render()

		act(() => showContextualFields.set(true))

		expect(circles()).toHaveLength(1)
	})

	describe('when a node is selected', () => {
		function select(...ids: string[]) {
			act(() => {
				editor.select(...ids.map(nodeIdToShapeId))
			})
		}

		it('highlights the selected node’s field', () => {
			createPostIt('a', 0, 0, 500)
			createPostIt('b', 1500, 0, 500)
			render()

			select('a')

			expect(circleFor('a').dataset.selected).toBe('true')
			expect(circleFor('b').dataset.selected).toBe('false')
		})

		it('highlights every selected node’s field', () => {
			createPostIt('a', 0, 0, 500)
			createPostIt('b', 1500, 0, 500)
			render()

			select('a', 'b')

			expect(circleFor('a').dataset.selected).toBe('true')
			expect(circleFor('b').dataset.selected).toBe('true')
		})

		it('draws the highlight more heavily than an unselected field', () => {
			createPostIt('a', 0, 0, 500)
			createPostIt('b', 1500, 0, 500)
			render()

			select('a')

			const selected = circleFor('a')
			const unselected = circleFor('b')

			expect(parseFloat(selected.style.borderWidth)).toBeGreaterThan(
				parseFloat(unselected.style.borderWidth)
			)
			expect(selected.style.borderStyle).toBe('solid')
			expect(unselected.style.borderStyle).toBe('dashed')
		})

		/**
		 * Fields overlap by design, and a translucent circle drawn later would wash
		 * over the outline of the one the user is actually looking at.
		 */
		it('draws the highlighted field last, so nothing paints over it', () => {
			createPostIt('a', 0, 0, 500)
			createPostIt('b', 200, 0, 500)
			render()

			select('a')

			expect(circles().at(-1)!.dataset.contextualField).toBe('a')
		})

		it('has nothing to highlight when the selected node has no field', () => {
			createPostIt('a', 0, 0)
			createPostIt('b', 1500, 0, 500)
			render()

			select('a')

			expect(circles().map((element) => element.dataset.contextualField)).toEqual(['b'])
			expect(circleFor('b').dataset.selected).toBe('false')
		})

		it('drops the highlight when the selection is cleared', () => {
			createPostIt('a', 0, 0, 500)
			render()

			select('a')
			act(() => {
				editor.selectNone()
			})

			expect(circleFor('a').dataset.selected).toBe('false')
		})

		it('stays hidden while the switch is off, selection or not', () => {
			createPostIt('a', 0, 0, 500)
			showContextualFields.set(false)
			render()

			select('a')

			expect(circles()).toEqual([])
		})
	})

	/**
	 * The overlay lives inside the camera-transformed layer, so an untouched 1px
	 * border would render 4px thick at 4× zoom and vanish when zoomed out.
	 */
	it('thins its outline as the camera zooms in', () => {
		createPostIt('a', 0, 0, 500)
		render()

		const atDefaultZoom = circleFor('a').style.borderWidth

		act(() => {
			editor.setCamera({ x: 0, y: 0, z: 4 })
		})

		expect(parseFloat(circleFor('a').style.borderWidth)).toBeLessThan(parseFloat(atDefaultZoom))
	})
})
