/**
 * @vitest-environment jsdom
 *
 * The gravity control, rendered for real against a real editor.
 *
 * `relations.ts`'s tests prove the write is correct and reaches the canonical
 * Canvas. What they can't cover is whether the control *calls* it — which is where
 * "I typed 0.35 and nothing happened" lives, and the reason the radius control
 * commits on unmount.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	createShapeId,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultTools,
	Editor,
	EditorContext,
	type TLShapeId,
} from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeIdToShapeId, shapeIdToRelationId } from '@/canvas/adapter/ids'
import {
	ARROW_SHAPE_TYPE,
	RELATION_GRAVITY_META_KEY,
	RELATION_META_KEY,
} from '@/canvas/adapter/relations'
import { RelationGravityControl } from '@/canvas/ui/RelationGravityControl'

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
				<RelationGravityControl />
			</EditorContext.Provider>
		)
	})
}

function createPostIt(id: string, x = 0, y = 0) {
	editor.createShape({
		...nodeToShape(createPostItNode({ id, x, y })),
		parentId: editor.getCurrentPageId(),
	})

	return nodeIdToShapeId(id)
}

/** An arrow bound at both ends, as the Relation tool leaves one. */
function createRelation(from: TLShapeId, to: TLShapeId, gravity?: number) {
	const id = createShapeId()

	editor.createShape({
		id,
		type: ARROW_SHAPE_TYPE,
		parentId: editor.getCurrentPageId(),
		meta: {
			[RELATION_META_KEY]: true,
			...(gravity === undefined ? {} : { [RELATION_GRAVITY_META_KEY]: gravity }),
		},
	})

	editor.createBindings(
		(['start', 'end'] as const).map((terminal) => ({
			type: ARROW_SHAPE_TYPE,
			fromId: id,
			toId: terminal === 'start' ? from : to,
			props: {
				terminal,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
			},
		}))
	)

	return id
}

/** A pair of post-its and a relation between them — the minimum this control needs. */
function scene(gravity?: number) {
	const a = createPostIt('a', 0, 0)
	const b = createPostIt('b', 600, 0)

	return createRelation(a, b, gravity)
}

/** Read through the canonical document, so the assertions are about the model. */
function gravityOf(arrow: TLShapeId) {
	return getCanvasDocument(editor).relations[shapeIdToRelationId(arrow)]?.gravity
}

function input() {
	const element = container.querySelector('input')
	expect(element, 'the gravity input is not rendered').not.toBeNull()

	return element!
}

/**
 * Sets a controlled input's value the way a user typing into it would. React
 * patches the property to track changes itself, so a plain assignment updates the
 * DOM behind its back and `onChange` never fires.
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

function blur(element: HTMLElement) {
	act(() => {
		element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
	})
}

describe('visibility', () => {
	it('renders nothing when nothing is selected', () => {
		scene()
		editor.selectNone()
		render()

		expect(container.querySelector('input')).toBeNull()
	})

	/** A post-it has no gravity to set, and the panel must not suggest it does. */
	it('renders nothing for a selected post-it', () => {
		scene()
		editor.select(nodeIdToShapeId('a'))
		render()

		expect(container.querySelector('input')).toBeNull()
	})

	it('shows the full-strength default for a freshly drawn relation', () => {
		const arrow = scene()
		editor.select(arrow)
		render()

		expect(input().value).toBe('1')
	})

	it('shows an existing gravity', () => {
		const arrow = scene(0.35)
		editor.select(arrow)
		render()

		expect(input().value).toBe('0.35')
	})

	it('says so when two selected relations disagree', () => {
		const first = scene(1)
		const second = createRelation(nodeIdToShapeId('b'), nodeIdToShapeId('a'), 0.2)
		editor.select(first, second)
		render()

		expect(input().placeholder).toBe('mixed')
		expect(input().value).toBe('')
	})
})

describe('typing a gravity', () => {
	it('commits on Enter', () => {
		const arrow = scene()
		editor.select(arrow)
		render()

		type(input(), '0.35')
		expect(gravityOf(arrow)).toBe(1) // not until it's committed

		press(input(), 'Enter')
		expect(gravityOf(arrow)).toBe(0.35)
	})

	it('commits on blur', () => {
		const arrow = scene()
		editor.select(arrow)
		render()

		type(input(), '0.5')
		blur(input())

		expect(gravityOf(arrow)).toBe(0.5)
	})

	/** A deliberate zero is a claim, so it has to be committable. */
	it('commits a zero', () => {
		const arrow = scene()
		editor.select(arrow)
		render()

		type(input(), '0')
		press(input(), 'Enter')

		expect(gravityOf(arrow)).toBe(0)
	})

	/**
	 * An emptied box is a half-finished edit, not "these are barely related". The
	 * radius control reads empty as *clear the field*; there is nothing to clear
	 * here, so it must not be read as `0`.
	 */
	it('ignores an emptied box rather than reading it as zero', () => {
		const arrow = scene(0.5)
		editor.select(arrow)
		render()

		type(input(), '')
		press(input(), 'Enter')

		expect(gravityOf(arrow)).toBe(0.5)
	})

	it('abandons the edit on Escape', () => {
		const arrow = scene(0.5)
		editor.select(arrow)
		render()

		type(input(), '0.9')
		press(input(), 'Escape')

		expect(gravityOf(arrow)).toBe(0.5)
		expect(input().value).toBe('0.5')
	})

	it('clamps what it commits', () => {
		const arrow = scene()
		editor.select(arrow)
		render()

		type(input(), '5')
		press(input(), 'Enter')

		expect(gravityOf(arrow)).toBe(1)
	})

	it('sets every selected relation at once', () => {
		const first = scene(1)
		const second = createRelation(nodeIdToShapeId('b'), nodeIdToShapeId('a'), 0.2)
		editor.select(first, second)
		render()

		type(input(), '0.4')
		press(input(), 'Enter')

		expect(gravityOf(first)).toBe(0.4)
		expect(gravityOf(second)).toBe(0.4)
	})
})

describe('reactivity', () => {
	it('picks up a gravity set from somewhere else', () => {
		// Proves the control is a view over the editor rather than local state.
		const arrow = scene()
		editor.select(arrow)
		render()

		act(() => {
			editor.updateShapes([
				{ id: arrow, type: ARROW_SHAPE_TYPE, meta: { [RELATION_GRAVITY_META_KEY]: 0.6 } },
			])
		})

		expect(input().value).toBe('0.6')
	})

	it('still commits when the click deselected the arrow', () => {
		// Clicking anything that reaches the canvas deselects first, which unmounts
		// this control before its blur event can fire. Losing the selection must not
		// mean losing the edit.
		const arrow = scene()
		editor.select(arrow)
		render()

		type(input(), '0.25')
		act(() => editor.selectNone())

		expect(container.querySelector('input')).toBeNull()
		expect(gravityOf(arrow)).toBe(0.25)
	})

	it('lands the value on the relation it was typed for', () => {
		const first = scene()
		const second = createRelation(nodeIdToShapeId('b'), nodeIdToShapeId('a'))
		editor.select(first)
		render()

		type(input(), '0.25')
		act(() => editor.select(second))
		blur(input())

		expect(gravityOf(first)).toBe(0.25)
		expect(gravityOf(second)).toBe(1)
	})

	it('drops a half-typed value when the selection changes', () => {
		const first = scene()
		const second = createRelation(nodeIdToShapeId('b'), nodeIdToShapeId('a'))
		editor.select(first)
		render()

		type(input(), '0.9')
		act(() => editor.select(second))

		// The unfinished value must not follow the selection onto the other relation.
		expect(input().value).toBe('1')
		blur(input())
		expect(gravityOf(second)).toBe(1)
	})
})
