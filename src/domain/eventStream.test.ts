/**
 * The in-process event stream.
 *
 * A subscribable buffer of `SpatialEvent`s — the thing a debug panel renders and a
 * AI companion attaches to. It stores nothing about the canvas; it only relays
 * and retains what `deriveEvents` produced.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SpatialEvent } from '@/domain/events'
import { createEventStream, spatialEventStream } from '@/domain/eventStream'

const created = (nodeId: string): SpatialEvent => ({ type: 'node_created', nodeId })

describe('createEventStream — subscription', () => {
	it('delivers each emitted event to a subscriber, in order', () => {
		const stream = createEventStream()
		const seen: SpatialEvent[] = []
		stream.subscribe((event) => seen.push(event))

		stream.emit([created('a'), created('b')])

		expect(seen).toEqual([created('a'), created('b')])
	})

	it('delivers to every subscriber', () => {
		const stream = createEventStream()
		const one = vi.fn()
		const two = vi.fn()
		stream.subscribe(one)
		stream.subscribe(two)

		stream.emit([created('a')])

		expect(one).toHaveBeenCalledWith(created('a'))
		expect(two).toHaveBeenCalledWith(created('a'))
	})

	it('stops delivering after unsubscribe', () => {
		const stream = createEventStream()
		const listener = vi.fn()
		const unsubscribe = stream.subscribe(listener)

		unsubscribe()
		stream.emit([created('a')])

		expect(listener).not.toHaveBeenCalled()
	})
})

describe('createEventStream — retained history', () => {
	it('remembers emitted events in chronological order', () => {
		const stream = createEventStream()

		stream.emit([created('a')])
		stream.emit([created('b'), created('c')])

		expect(stream.getRecent()).toEqual([created('a'), created('b'), created('c')])
	})

	it('returns only the last `limit` events when asked', () => {
		const stream = createEventStream()
		stream.emit([created('a'), created('b'), created('c')])

		expect(stream.getRecent(2)).toEqual([created('b'), created('c')])
	})

	it('drops the oldest events past the buffer size', () => {
		const stream = createEventStream(2)

		stream.emit([created('a'), created('b'), created('c')])

		expect(stream.getRecent()).toEqual([created('b'), created('c')])
	})

	it('empties the history on clear', () => {
		const stream = createEventStream()
		stream.emit([created('a')])

		stream.clear()

		expect(stream.getRecent()).toEqual([])
	})
})

describe('spatialEventStream singleton', () => {
	it('is a usable stream', () => {
		expect(typeof spatialEventStream.subscribe).toBe('function')
		expect(typeof spatialEventStream.emit).toBe('function')
		expect(typeof spatialEventStream.getRecent).toBe('function')
	})
})
