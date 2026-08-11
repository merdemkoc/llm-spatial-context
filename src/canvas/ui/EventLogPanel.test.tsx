/**
 * @vitest-environment jsdom
 *
 * The event log, rendered for real.
 *
 * The stream's own test proves delivery and retention; this proves the panel is a live
 * view of it — that an emitted event appears, that a late-mounting panel shows the
 * history it missed, and that Clear empties it. The stream is injected so each test runs
 * against a fresh one rather than the app-wide singleton.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEventStream, type SpatialEvent, type SpatialEventStream } from '@/domain'
import { EventLogPanel } from '@/canvas/ui/EventLogPanel'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

let stream: SpatialEventStream
let container: HTMLDivElement
let root: Root

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	stream = createEventStream()
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render() {
	act(() => root.render(<EventLogPanel stream={stream} />))
}

function emit(...events: SpatialEvent[]) {
	act(() => stream.emit(events))
}

const entered: SpatialEvent = {
	type: 'field_entered',
	source: 'a',
	target: 'b',
	previous: { distance: 600, influence: 0 },
	current: { distance: 300, influence: 0.4 },
}

function button(label: string) {
	return [...container.querySelectorAll('button')].find((element) =>
		element.textContent?.includes(label)
	)
}

describe('EventLogPanel', () => {
	it('shows an event emitted after it mounts', () => {
		render()
		emit(entered)

		expect(container.textContent).toContain('field_entered')
		expect(container.textContent).toContain('a')
		expect(container.textContent).toContain('b')
	})

	it('shows the history a late-mounting panel missed', () => {
		emit(entered)
		render()

		expect(container.textContent).toContain('field_entered')
	})

	it('shows the newest event first', () => {
		render()
		emit({ type: 'node_created', nodeId: 'first' })
		emit({ type: 'node_created', nodeId: 'second' })

		const text = container.textContent ?? ''
		expect(text.indexOf('second')).toBeLessThan(text.indexOf('first'))
	})

	it('empties on Clear', () => {
		render()
		emit(entered)
		expect(container.textContent).toContain('field_entered')

		act(() => button('Clear')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

		expect(container.textContent).not.toContain('field_entered')
		expect(stream.getRecent()).toEqual([])
	})
})
