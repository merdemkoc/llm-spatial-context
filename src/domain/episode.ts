/**
 * Interaction episodes — the unit the AI observer reasons about.
 *
 * The event stream is a continuous trickle: a drag emits many `node_moved`s and
 * `influence_changed`s, one per store tick. Handing each to the AI would be noise. An
 * *episode* is the MVP-2 grouping: everything that happened between one pause and the
 * next, folded to a compact "before → after" the observer can interpret as a single
 * gesture.
 *
 * Three pure pieces, none of which touch tldraw or the network:
 *   - `buildEpisodeSummary` folds a buffer of events into per-pair before/after + the
 *     structural changes, verbatim and in order.
 *   - `isTrivialEpisode` is the cheap local gate (stage one of two): it drops episodes
 *     that carry no meaningful structural change and only sub-threshold influence
 *     nudges, so the model is never asked about genuine noise. The model makes the real
 *     meaningfulness call on everything that survives.
 *   - `createEpisodeRecorder` buffers a live stream and finalizes an episode after a
 *     pause. The timer is injected so it is testable without waiting real seconds.
 */
import type { PairSnapshot, SpatialEvent } from '@/domain/events'
import type { NodeId } from '@/domain/node'
import type { SpatialEventStream } from '@/domain/eventStream'

/** How long the canvas must be quiet before the current episode is considered finished. */
export const EPISODE_IDLE_MS = 2000

/**
 * The influence shift below which a pair's change is treated as noise by the local gate.
 *
 * A coarse floor, not a meaningfulness judgement: it exists only to keep genuine nudges
 * (MVP-2 Example 5, 0.36 → 0.39) off the wire. Anything above it is handed to the model,
 * which decides whether it is worth speaking about. Tunable.
 */
export const TRIVIAL_INFLUENCE_EPSILON = 0.05

/** One directed pair's spatial state at the start and end of an episode. */
export interface EpisodePairChange {
	source: NodeId
	target: NodeId
	before: PairSnapshot
	after: PairSnapshot
}

/**
 * An episode, folded for the observer.
 *
 * `structural` is the node/relation/field changes verbatim and in order (including the
 * `node_moved`s that carry no semantic weight on their own); `pairs` is the net influence
 * shift per directed pair, first-seen `previous` to last-seen `current`.
 */
export interface EpisodeSummary {
	structural: SpatialEvent[]
	pairs: EpisodePairChange[]
}

/** Schedule `fn` to run after `ms`; the returned function cancels it if not yet run. */
export type Schedule = (fn: () => void, ms: number) => () => void

export interface EpisodeRecorderOptions {
	/** Called once per finalized episode, after the idle pause. */
	onEpisode: (summary: EpisodeSummary) => void
	/** Timer source; defaults to `setTimeout`. Injected so tests need no real clock. */
	schedule?: Schedule
	/** Idle pause before an episode is finalized. Defaults to `EPISODE_IDLE_MS`. */
	idleMs?: number
}

const PAIR_EVENT_TYPES = ['field_entered', 'field_exited', 'influence_changed', 'proximity_changed']

type PairEvent = Extract<
	SpatialEvent,
	{ type: 'field_entered' | 'field_exited' | 'influence_changed' | 'proximity_changed' }
>

function isPairEvent(event: SpatialEvent): event is PairEvent {
	return PAIR_EVENT_TYPES.includes(event.type)
}

/**
 * Fold a buffer of events into an episode summary.
 *
 * Structural events pass through untouched. Pair events are collapsed per directed pair:
 * the first sighting fixes `before`, every later sighting advances `after`, so a pair
 * dragged through several intermediate positions reports one net transition. Insertion
 * order of the pairs is preserved.
 */
export function buildEpisodeSummary(events: SpatialEvent[]): EpisodeSummary {
	const structural = events.filter((event) => !isPairEvent(event))

	const order: string[] = []
	const byPair = new Map<string, EpisodePairChange>()
	for (const event of events) {
		if (!isPairEvent(event)) continue
		const key = `${event.source}\u0000${event.target}`
		const existing = byPair.get(key)
		if (existing === undefined) {
			order.push(key)
			byPair.set(key, {
				source: event.source,
				target: event.target,
				before: event.previous,
				after: event.current,
			})
		} else {
			existing.after = event.current
		}
	}

	return { structural, pairs: order.map((key) => byPair.get(key)!) }
}

/**
 * The local significance gate.
 *
 * Any structural change other than a bare move — a relation created or removed, a field
 * resized, a node added or deleted — is always worth the model's attention. Failing that,
 * an episode is trivial when every pair's net influence shift stays under the epsilon; an
 * episode with no pairs at all (a lone node nudged in empty space) is trivial too.
 */
export function isTrivialEpisode(summary: EpisodeSummary): boolean {
	const hasMeaningfulStructural = summary.structural.some((event) => event.type !== 'node_moved')
	if (hasMeaningfulStructural) return false

	return summary.pairs.every(
		(pair) => Math.abs(pair.after.influence - pair.before.influence) < TRIVIAL_INFLUENCE_EPSILON
	)
}

const defaultSchedule: Schedule = (fn, ms) => {
	const id = setTimeout(fn, ms)
	return () => clearTimeout(id)
}

/**
 * Buffer a live stream and finalize an episode once it falls quiet.
 *
 * Every event resets the idle timer; when the canvas has been still for `idleMs`, the
 * buffer is folded and handed to `onEpisode`, then cleared for the next episode. Returns
 * a disposer that unsubscribes and cancels any pending finalize — collect it alongside
 * the other `handleMount` disposers so a React StrictMode remount can't leave two
 * recorders running.
 */
export function createEpisodeRecorder(
	stream: SpatialEventStream,
	{ onEpisode, schedule = defaultSchedule, idleMs = EPISODE_IDLE_MS }: EpisodeRecorderOptions
): () => void {
	let buffer: SpatialEvent[] = []
	let cancel: (() => void) | null = null

	const finalize = () => {
		cancel = null
		if (buffer.length === 0) return
		const events = buffer
		buffer = []
		onEpisode(buildEpisodeSummary(events))
	}

	const unsubscribe = stream.subscribe((event) => {
		buffer.push(event)
		cancel?.()
		cancel = schedule(finalize, idleMs)
	})

	return () => {
		unsubscribe()
		cancel?.()
		cancel = null
		buffer = []
	}
}
