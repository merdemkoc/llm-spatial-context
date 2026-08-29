/**
 * @vitest-environment jsdom
 *
 * Following the companion's attention with the camera, against a real editor.
 *
 * The move itself is one `zoomToBounds` call and not worth pinning. What is worth pinning is
 * everything it refuses to do: move while the user is dragging, zoom past 1:1 onto two adjacent
 * notes, slide when the user has asked for reduced motion, or move at all with the switch off.
 * Each of those is a line that reads as a detail and is the whole difference between a helpful
 * camera and an infuriating one.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultTools,
	Box,
	Editor,
	EditorContext,
	type TLStore,
} from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { CompanionFocusCamera } from '@/canvas/ui/CompanionFocusCamera'
import { companionFocus, followEnabled } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let container: HTMLDivElement
let root: Root
let editor: Editor
let store: TLStore
let zoomToBounds: ReturnType<typeof vi.fn>

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	companionFocus.set([])
	followEnabled.set(true)

	store = createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils })
	editor = new Editor({
		store,
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [...defaultTools],
		getContainer: () => document.createElement('div'),
	})
	// jsdom measures every element as 0×0, and the zoom cap is a ratio against the viewport —
	// so it has to be stated rather than measured.
	editor.getViewportScreenBounds = () => new Box(0, 0, 1400, 800)
	zoomToBounds = vi.fn()
	editor.zoomToBounds = zoomToBounds as unknown as Editor['zoomToBounds']

	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function createPostIt(id: string, x: number, y: number) {
	const node = createPostItNode({ id, x, y, text: id })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

function render() {
	act(() =>
		root.render(
			<EditorContext.Provider value={editor}>
				<CompanionFocusCamera />
			</EditorContext.Provider>
		)
	)
}

/** Put the focus on `ids` after mounting, the way a remark beginning to play does. */
function focusOn(ids: string[]) {
	act(() => companionFocus.set(ids))
}

describe('CompanionFocusCamera', () => {
	it('frames the notes a remark is about', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 4000, 3000)
		render()

		focusOn(['a', 'b'])

		expect(zoomToBounds).toHaveBeenCalledTimes(1)
		const [bounds] = zoomToBounds.mock.calls[0]
		// Wide enough to hold both, which is the whole claim: it is looking at the pair.
		expect(bounds.width).toBeGreaterThan(4000)
		expect(bounds.height).toBeGreaterThan(3000)
	})

	it('does not zoom in past 1:1, however close together the notes are', () => {
		// Two adjacent post-its fit a 1400px viewport at about 600%. Fitting them is the point;
		// filling the screen with one word is not.
		createPostIt('a', 0, 0)
		createPostIt('b', 240, 0)
		render()

		focusOn(['a', 'b'])

		expect(zoomToBounds.mock.calls[0][1].targetZoom).toBe(1)
	})

	it('zooms out as far as the notes need', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 6000, 0)
		render()

		focusOn(['a', 'b'])

		expect(zoomToBounds.mock.calls[0][1].targetZoom).toBeLessThan(0.5)
	})

	it('stays put while the user is dragging', () => {
		// Not politeness: moving the camera mid-drag drags the note somewhere never pointed at.
		createPostIt('a', 0, 0)
		render()
		editor.inputs.isDragging = true

		focusOn(['a'])

		expect(zoomToBounds).not.toHaveBeenCalled()
	})

	it('stays put when following is switched off', () => {
		createPostIt('a', 0, 0)
		followEnabled.set(false)
		render()

		focusOn(['a'])

		expect(zoomToBounds).not.toHaveBeenCalled()
	})

	it('arrives instead of sliding when the user has asked for reduced motion', () => {
		createPostIt('a', 0, 0)
		editor.user.updateUserPreferences({ animationSpeed: 0 })
		render()

		focusOn(['a'])

		expect(zoomToBounds.mock.calls[0][1].animation.duration).toBe(0)
	})

	it('slides otherwise', () => {
		createPostIt('a', 0, 0)
		// Stated rather than assumed: jsdom has no `matchMedia`, so tldraw's default reading of
		// the reduced-motion preference is the cautious one.
		editor.user.updateUserPreferences({ animationSpeed: 1 })
		render()

		focusOn(['a'])

		expect(zoomToBounds.mock.calls[0][1].animation.duration).toBeGreaterThan(0)
	})

	it('goes nowhere when every note the remark named has been deleted', () => {
		render()

		focusOn(['gone'])

		expect(zoomToBounds).not.toHaveBeenCalled()
	})

	it('does not move again when the remark ends', () => {
		// The focus clears at the end of every clip. Treating that as a move would send the
		// camera somewhere on each remark's last word.
		createPostIt('a', 0, 0)
		render()
		focusOn(['a'])

		focusOn([])

		expect(zoomToBounds).toHaveBeenCalledTimes(1)
	})
})
