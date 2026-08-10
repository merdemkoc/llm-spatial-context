/**
 * @vitest-environment jsdom
 *
 * The radius control, rendered for real against a real editor.
 *
 * The adapter tests prove the write is correct and the editor tests prove it
 * reaches the canonical Canvas. What neither covers is whether the control
 * actually *calls* it — which is exactly where "I set 500 and nothing happened"
 * lives.
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
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { ContextualFieldControl } from '@/canvas/ui/ContextualFieldControl'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<ContextualFieldControl />
			</EditorContext.Provider>
		)
	})
}

function createPostIt(id: string, x = 0, y = 0, radius?: number) {
	const node = createPostItNode({ id, x, y, radius })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })

	return nodeIdToShapeId(id)
}

function radiusOf(id: string) {
	return getCanvasDocument(editor).nodes[id]?.contextualField?.radius
}

function input() {
	const element = container.querySelector('input')
	expect(element, 'the radius input is not rendered').not.toBeNull()

	return element!
}

function button() {
	const element = container.querySelector('button')
	expect(element, 'the add/clear button is not rendered').not.toBeNull()

	return element!
}

/**
 * Sets a controlled input's value the way a user typing into it would.
 *
 * Goes through the native value setter rather than assigning `element.value`:
 * React patches the property to track changes itself, and a plain assignment
 * updates the DOM behind its back, so `onChange` never fires and the rendered
 * value desyncs from the DOM.
 */
const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

function type(element: HTMLInputElement, value: string) {
	act(() => {
		nativeValueSetter.call(element, value)
		element.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

function press(element: HTMLElement, key: string) {
	act(() => {
		element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
	})
}

function click(element: HTMLElement) {
	act(() => {
		element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	})
}

function blur(element: HTMLElement) {
	act(() => {
		element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
	})
}

describe('visibility', () => {
	it('renders nothing when no post-it is selected', () => {
		createPostIt('a')
		editor.selectNone()
		render()

		expect(container.querySelector('input')).toBeNull()
	})

	it('renders the control when a post-it is selected', () => {
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		expect(input().placeholder).toBe('none')
		expect(button().textContent).toBe('Add')
	})

	it('shows an existing radius, and offers to clear it', () => {
		createPostIt('a', 0, 0, 320)
		editor.select(nodeIdToShapeId('a'))
		render()

		expect(input().value).toBe('320')
		expect(button().textContent).toBe('Clear')
	})
})

describe('the Add button', () => {
	it('gives the selection a radius', () => {
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		click(button())

		expect(radiusOf('a')).toBe(500)
	})

	it('clears the radius once there is one', () => {
		createPostIt('a', 0, 0, 500)
		editor.select(nodeIdToShapeId('a'))
		render()

		click(button())

		expect(radiusOf('a')).toBeUndefined()
	})
})

describe('typing a radius', () => {
	it('commits on Enter', () => {
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '250')
		expect(radiusOf('a')).toBeUndefined() // not until it's committed

		press(input(), 'Enter')
		expect(radiusOf('a')).toBe(250)
	})

	it('commits on blur', () => {
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '180')
		blur(input())

		expect(radiusOf('a')).toBe(180)
	})

	it('clears the field when emptied', () => {
		createPostIt('a', 0, 0, 500)
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '')
		press(input(), 'Enter')

		expect(radiusOf('a')).toBeUndefined()
	})

	it('abandons the edit on Escape', () => {
		createPostIt('a', 0, 0, 500)
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '99')
		press(input(), 'Escape')

		expect(radiusOf('a')).toBe(500)
		expect(input().value).toBe('500')
	})

	it('reflects the committed value back into the input', () => {
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '250')
		press(input(), 'Enter')

		expect(input().value).toBe('250')
	})
})

describe('reactivity', () => {
	it('picks up a radius set from somewhere else', () => {
		// Proves the control is a view over the editor rather than local state.
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		expect(input().value).toBe('')

		act(() => {
			editor.updateShapes([
				{
					id: nodeIdToShapeId('a'),
					type: POST_IT_SHAPE_TYPE,
					meta: { contextualField: { radius: 640 } },
				},
			])
		})

		expect(input().value).toBe('640')
	})

	it('still commits when the click deselected the post-it', () => {
		// The reported bug. Clicking anything that reaches the canvas — including
		// the Inspector's own toggle — deselects first, which unmounts this control
		// before its blur event can fire. Losing the selection must not mean losing
		// the edit, so the pending value is committed on the way out.
		createPostIt('a')
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '500')
		act(() => editor.selectNone())

		// The input is genuinely gone — there is nothing left to blur.
		expect(container.querySelector('input')).toBeNull()
		expect(radiusOf('a')).toBe(500)
	})

	it('still commits when the selection moved to a different post-it', () => {
		createPostIt('a')
		createPostIt('b', 400)
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '500')
		act(() => editor.select(nodeIdToShapeId('b')))
		blur(input())

		// A's value lands on A, not on whatever happens to be selected now.
		expect(radiusOf('a')).toBe(500)
		expect(radiusOf('b')).toBeUndefined()
	})

	it('drops a half-typed radius when the selection changes', () => {
		createPostIt('a')
		createPostIt('b', 400)
		editor.select(nodeIdToShapeId('a'))
		render()

		type(input(), '999')

		act(() => editor.select(nodeIdToShapeId('b')))

		// The unfinished value must not follow the selection onto B.
		expect(input().value).toBe('')
		blur(input())
		expect(radiusOf('b')).toBeUndefined()
	})
})
