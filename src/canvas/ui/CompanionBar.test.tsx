/**
 * @vitest-environment jsdom
 *
 * The companion's bar, rendered for real.
 *
 * The bar is the only permanently visible piece of our UI, so what it says in each of its
 * three states is worth pinning down: a resting label when the companion has said nothing
 * (there has to be something to click), the newest sentence once it has spoken, and the
 * thinking indicator *instead of* the chip while the model is being consulted — stacking
 * the two was the corner-crowding problem this layout exists to undo.
 *
 * The harness carries an editor and `TldrawUiContextProvider` because the chip is built
 * from tldraw's own button and popover: the popover's content resolves the editor's
 * container even while closed, and the UI contexts supply breakpoints and translations.
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
	TldrawUiContextProvider,
} from 'tldraw'
import { CompanionBar } from '@/canvas/ui/CompanionBar'
import { companionStage, companionTranscript, companionUtterance } from '@/companion/companionState'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let editor: Editor
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	// jsdom's Image has no `decode`, which tldraw's icon preloader calls.
	HTMLImageElement.prototype.decode ??= () => Promise.resolve()

	companionTranscript.set([])
	companionStage.set('idle')

	editor = new Editor({
		store: createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils: defaultShapeUtils,
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
	companionTranscript.set([])
	companionStage.set('idle')
	companionUtterance.set(null)
})

function render() {
	act(() => {
		root.render(
			<EditorContext.Provider value={editor}>
				<TldrawUiContextProvider>
					<CompanionBar />
				</TldrawUiContextProvider>
			</EditorContext.Provider>
		)
	})
}

describe('CompanionBar', () => {
	it('rests as a label when the companion has said nothing', () => {
		render()

		expect(container.textContent).toContain('Companion')
		// The affordance has to be clickable even with nothing to show, or the transcript
		// would be unreachable until the model happened to speak.
		expect(container.querySelector('button')).not.toBeNull()
	})

	it('reports the newest sentence', () => {
		companionTranscript.set([
			{ comment: 'first observation', at: 1 },
			{ comment: 'second observation', at: 2 },
		])
		render()

		const text = container.textContent ?? ''
		expect(text).toContain('second observation')
		expect(text).not.toContain('first observation')
	})

	it('sets a remark to a measure instead of clipping it to one line', () => {
		const comment =
			'Launch Friday has drifted right into User research’s reach — those two are starting to look like one piece of work.'
		companionTranscript.set([{ comment, at: 1 }])
		render()

		const sentence = [...container.querySelectorAll('span')].find(
			(span) => span.textContent === comment
		)
		expect(sentence).toBeDefined()
		// A sentence given the whole width renders as one clipped line, which reads as a
		// fragment — so it wraps, and the chip grows instead of the text being cut.
		expect(sentence!.style.whiteSpace).toBe('normal')
		expect(sentence!.style.maxWidth).not.toBe('')
		expect(container.querySelector('button')!.style.height).toBe('auto')
	})

	it('counts the rest, so the bar says how much it is not showing', () => {
		companionTranscript.set([
			{ comment: 'first observation', at: 1 },
			{ comment: 'second observation', at: 2 },
		])
		render()

		expect(container.textContent).toContain('· 2')
	})

	it('says nothing about a count when there is only one comment', () => {
		companionTranscript.set([{ comment: 'only observation', at: 1 }])
		render()

		expect(container.textContent).toContain('only observation')
		expect(container.textContent).not.toContain('·')
	})

	it('shows only what has been spoken while a remark is being said', () => {
		const comment = 'Those two ideas are converging.'
		// The transcript already holds it whole — that is the record of the decision — but
		// the bar must not run ahead of the voice.
		companionTranscript.set([{ comment, at: 1 }])
		companionUtterance.set({ comment, fraction: 0.4 })
		render()

		expect(container.textContent).toContain('Those two ideas')
		expect(container.textContent).not.toContain('converging')
	})

	it('shows the remark whole once the clip has ended', () => {
		const comment = 'Those two ideas are converging.'
		companionTranscript.set([{ comment, at: 1 }])
		companionUtterance.set(null)
		render()

		expect(container.textContent).toContain(comment)
	})

	it('shows the thinking indicator instead of the chip, not beside it', () => {
		companionTranscript.set([{ comment: 'an earlier observation', at: 1 }])
		companionStage.set('observing')
		render()

		const text = container.textContent ?? ''
		expect(text).toContain('thinking')
		expect(text).not.toContain('an earlier observation')
	})
})
