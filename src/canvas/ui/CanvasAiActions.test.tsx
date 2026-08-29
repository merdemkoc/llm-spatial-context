/**
 * @vitest-environment jsdom
 *
 * The AI action buttons that sit by the toolbar.
 *
 * Two on-demand actions — suggest a grouping, reflect on the board — call the companion's
 * published handles. Each is disabled when the companion is asleep, unmounted, or already has a
 * proposal waiting to be decided, mirroring the orchestrator's own guards.
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
import { CanvasAiActions } from '@/canvas/ui/CanvasAiActions'
import {
	groupingSuggestion,
	ideaSuggestions,
	observationEnabled,
	requestGrouping,
	requestReflection,
} from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let editorContainer: HTMLDivElement
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	observationEnabled.set(true)
	groupingSuggestion.set(null)
	ideaSuggestions.set([])
	requestGrouping.set(() => {})
	requestReflection.set(() => {})

	// A stable, document-attached container so the prompt's portal lands somewhere findable.
	editorContainer = document.createElement('div')
	document.body.append(editorContainer)
	editor = new Editor({
		store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [...defaultTools],
		getContainer: () => editorContainer,
	})

	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	editorContainer.remove()
	groupingSuggestion.set(null)
	ideaSuggestions.set([])
	requestGrouping.set(null)
	requestReflection.set(null)
})

function render() {
	act(() =>
		root.render(
			<EditorContext.Provider value={editor}>
				<CanvasAiActions />
			</EditorContext.Provider>
		)
	)
}

function button(text: string): HTMLButtonElement {
	const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
	expect(found, `no "${text}" button`).toBeTruthy()
	return found as HTMLButtonElement
}

/** Set a React-controlled input's value: go through the native setter, then fire `input`. */
function setInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
	act(() => {
		setter.call(input, value)
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

describe('CanvasAiActions', () => {
	it('offers both actions', () => {
		render()
		expect(button('Suggest a grouping')).toBeTruthy()
		expect(button('Reflect')).toBeTruthy()
	})

	it('opens a prompt rather than grouping immediately', () => {
		const request = vi.fn()
		requestGrouping.set(request)
		render()

		act(() => button('Suggest a grouping').click())

		expect(document.querySelector('[data-grouping-prompt]')).toBeTruthy()
		expect(request).not.toHaveBeenCalled()
	})

	it('groups by the typed intent', () => {
		const request = vi.fn()
		requestGrouping.set(request)
		render()
		act(() => button('Suggest a grouping').click())

		const input = document.querySelector<HTMLInputElement>('[data-grouping-prompt] input')!
		setInputValue(input, 'group by risk')
		act(() => document.querySelector<HTMLButtonElement>('[data-grouping-submit]')!.click())

		expect(request).toHaveBeenCalledWith('group by risk')
		// The prompt closes once it has asked.
		expect(document.querySelector('[data-grouping-prompt]')).toBeNull()
	})

	it('groups by a preset chip in one click', () => {
		const request = vi.fn()
		requestGrouping.set(request)
		render()
		act(() => button('Suggest a grouping').click())

		const chip = [...document.querySelectorAll<HTMLButtonElement>('[data-grouping-preset]')].find(
			(b) => b.textContent?.toLowerCase().includes('theme')
		)!
		act(() => chip.click())

		expect(request).toHaveBeenCalledTimes(1)
		expect(request.mock.calls[0][0].toLowerCase()).toContain('theme')
	})

	it('requires an intent: the submit is disabled while the field is empty', () => {
		requestGrouping.set(vi.fn())
		render()
		act(() => button('Suggest a grouping').click())

		expect(document.querySelector<HTMLButtonElement>('[data-grouping-submit]')!.disabled).toBe(true)
	})

	it('opens a persona prompt rather than reflecting immediately', () => {
		const request = vi.fn()
		requestReflection.set(request)
		render()

		act(() => button('Reflect').click())

		expect(document.querySelector('[data-reflect-prompt]')).toBeTruthy()
		expect(request).not.toHaveBeenCalled()
	})

	it('reflects through the persona chosen from the prompt', () => {
		const request = vi.fn()
		requestReflection.set(request)
		render()
		act(() => button('Reflect').click())

		const chip = [...document.querySelectorAll<HTMLButtonElement>('[data-reflect-persona]')].find(
			(b) => b.textContent?.toLowerCase().includes('critique')
		)!
		act(() => chip.click())

		expect(request).toHaveBeenCalledWith('critique')
		expect(document.querySelector('[data-reflect-prompt]')).toBeNull()
	})

	it('disables both actions while observation is off', () => {
		observationEnabled.set(false)
		render()

		expect(button('Suggest a grouping').disabled).toBe(true)
		expect(button('Reflect').disabled).toBe(true)
	})

	it('disables both actions while a grouping is pending', () => {
		groupingSuggestion.set({ members: ['a', 'b'], targets: [], rationale: 'x' })
		render()

		expect(button('Suggest a grouping').disabled).toBe(true)
		expect(button('Reflect').disabled).toBe(true)
	})

	it('disables both actions while ideas are pending', () => {
		ideaSuggestions.set([{ id: 'idea-0', text: 'x', kind: 'idea', x: 0, y: 0 }])
		render()

		expect(button('Suggest a grouping').disabled).toBe(true)
		expect(button('Reflect').disabled).toBe(true)
	})

	it('disables an action whose handle is unpublished', () => {
		requestReflection.set(null)
		render()

		expect(button('Reflect').disabled).toBe(true)
		expect(button('Suggest a grouping').disabled).toBe(false)
	})
})
