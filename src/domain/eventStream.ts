/**
 * An in-process, subscribable stream of spatial events.
 *
 * The MVP 1 spec asks for "an internal event stream abstraction" that an AI
 * observer can subscribe to — deliberately local and in-process, no WebSockets. This
 * is it: subscribers receive each event as it is emitted, and a bounded ring of recent
 * events is retained so a panel mounting late, or a console reaching in, can read the
 * history without having been present for it.
 *
 * It holds no canvas state and derives nothing. The canvas remains the single source
 * of truth; this only relays what `deriveEvents` already produced. Kept in `src/domain`
 * because it imports no tldraw — the wiring that feeds it lives in the adapter layer.
 */
import type { SpatialEvent } from '@/domain/events'

export type EventListener = (event: SpatialEvent) => void

export interface SpatialEventStream {
	/** Relay a batch to every subscriber and append it to the retained history. */
	emit(events: SpatialEvent[]): void
	/** Receive every subsequent event. Returns an unsubscribe function. */
	subscribe(listener: EventListener): () => void
	/** The retained events, oldest first. With `limit`, only the most recent that many. */
	getRecent(limit?: number): SpatialEvent[]
	/** Forget the retained history. Subscriptions are unaffected. */
	clear(): void
}

/** How many events a stream keeps by default before dropping the oldest. */
export const DEFAULT_BUFFER_SIZE = 200

/**
 * A fresh stream.
 *
 * `bufferSize` bounds the retained history: a long session must not grow an unbounded
 * log, so the oldest events fall off once the ring is full. Subscribers see everything
 * regardless — the bound is on memory, not on delivery.
 */
export function createEventStream(bufferSize: number = DEFAULT_BUFFER_SIZE): SpatialEventStream {
	const listeners = new Set<EventListener>()
	let buffer: SpatialEvent[] = []

	return {
		emit(events) {
			if (events.length === 0) return

			buffer = [...buffer, ...events].slice(-bufferSize)
			// Deliver per event, not per batch, so a subscriber reacts to one thing at a
			// time — the "one item a subscriber can react to" the stream exists to provide.
			for (const event of events) {
				for (const listener of listeners) listener(event)
			}
		},

		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		getRecent(limit) {
			// A copy, so a caller can't mutate the retained history out from under the buffer.
			return limit === undefined ? [...buffer] : buffer.slice(-limit)
		},

		clear() {
			buffer = []
		},
	}
}

/**
 * The one stream the running app uses.
 *
 * A module-scope singleton, like `showContextualFields`: the adapter that feeds it and
 * the panel that reads it are siblings with no shared parent to hold an instance, and a
 * provider would be ceremony for a single prototype-wide stream. Deliberately not
 * persisted and not canonical — events are a record of change, not a fact about the
 * canvas, so they have no place in `shape.meta` or the canonical JSON.
 */
export const spatialEventStream = createEventStream()
