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

/**
 * How long the canvas must be quiet before the current episode is considered finished.
 *
 * This is dead time the user waits through before the companion has even started
 * thinking, so it is the cheapest second in the whole budget to buy back. The cost of
 * lowering it is a pause mid-arrangement being read as the end of an episode, which
 * means more episodes and so more chances to speak; `isTrivialEpisode` and the prompt's
 * silence-by-default are what keep that from becoming chatter. This is the dial if it does.
 *
 * The *resting* pause, not the only one: the companion hands `idleMs` a getter backed by
 * `createIdleBackoff`, which raises the pause when a gesture turns out to have been
 * misread as finished and walks it back down when one lands cleanly. This is where that
 * walk starts and ends.
 */
export const EPISODE_IDLE_MS = 1200

/**
 * The influence shift below which a pair's change is treated as noise by the local gate.
 *
 * A coarse floor, not a meaningfulness judgement: it exists only to keep genuine nudges
 * (MVP-2 Example 5, 0.36 → 0.39) off the wire. Anything above it is handed to the model,
 * which decides whether it is worth speaking about. Tunable.
 */
export const TRIVIAL_INFLUENCE_EPSILON = 0.05

/**
 * How many events one episode retains.
 *
 * A continuous interaction that never pauses would otherwise grow the buffer without
 * bound. Folding keeps the *summary* small whatever happens; this keeps the buffer that
 * feeds it small too. Generous, because dropping the oldest events of an episode loses
 * its `before` — so this is a backstop against a pathological session, not a working limit.
 */
export const EPISODE_BUFFER_LIMIT = 2000

/**
 * One directed pair's spatial state at the start and end of an episode.
 *
 * `transitions` keeps the classifications the domain already made — `field_entered`,
 * `proximity_changed:strong` — rather than making a reader re-derive them from the two
 * influence numbers. Ordered as they happened, deduplicated.
 */
export interface EpisodePairChange {
	source: NodeId
	target: NodeId
	before: PairSnapshot
	after: PairSnapshot
	transitions: string[]
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
	/**
	 * Called once per finalized episode, after the idle pause.
	 *
	 * `events` is the buffer the summary was folded from, verbatim. The fold is lossy by
	 * design, so a caller that may need to *re-fold* this episode together with the next one
	 * — because the pause turned out to be a false ending — cannot work from the summary.
	 */
	onEpisode: (summary: EpisodeSummary, events: SpatialEvent[]) => void
	/** Timer source; defaults to `setTimeout`. Injected so tests need no real clock. */
	schedule?: Schedule
	/**
	 * Idle pause before an episode is finalized, or a getter for one. Defaults to
	 * `EPISODE_IDLE_MS`.
	 *
	 * A getter is read each time the timer is armed — so every event — rather than once at
	 * construction. That is what lets a caller pacing itself adaptively (`createIdleBackoff`)
	 * have a raised pause govern the very gesture that raised it, instead of only the one
	 * after it.
	 */
	idleMs?: number | (() => number)
	/** Events one episode retains before dropping the oldest. Defaults to `EPISODE_BUFFER_LIMIT`. */
	bufferLimit?: number
}

const PAIR_EVENT_TYPES = ['field_entered', 'field_exited', 'influence_changed', 'proximity_changed']

type PairEvent = Extract<
	SpatialEvent,
	{ type: 'field_entered' | 'field_exited' | 'influence_changed' | 'proximity_changed' }
>

function isPairEvent(event: SpatialEvent): event is PairEvent {
	return PAIR_EVENT_TYPES.includes(event.type)
}

/** The transition a pair event names, carrying a proximity band's level with it. */
function transitionOf(event: PairEvent): string {
	return event.type === 'proximity_changed' ? `${event.type}:${event.level}` : event.type
}

/**
 * Fold a buffer of events into an episode summary.
 *
 * Everything is collapsed to net change, because the adapter diffs on every store change:
 * one drag emits a `node_moved` and an `influence_changed` per node per tick, so an
 * unfolded episode is hundreds of near-identical records that bury the few that matter.
 *
 * Per directed pair, the first sighting fixes `before` and every later one advances
 * `after`, keeping each distinct transition it passed through. `node_moved` folds the same
 * way, per node: the origin is the first seen, the destination the last. Other structural
 * events — a relation created, a field resized — are already one per gesture and pass
 * through untouched. First-seen order is preserved throughout.
 */
export function buildEpisodeSummary(events: SpatialEvent[]): EpisodeSummary {
	const structural: SpatialEvent[] = []
	const moveIndex = new Map<NodeId, number>()

	const pairOrder: string[] = []
	const byPair = new Map<string, EpisodePairChange>()
	for (const event of events) {
		if (!isPairEvent(event)) {
			if (event.type === 'node_moved') {
				const foldedAt = moveIndex.get(event.nodeId)
				if (foldedAt === undefined) {
					moveIndex.set(event.nodeId, structural.length)
					structural.push({ ...event })
				} else {
					// Advance the net destination in place; the origin stays the first one seen.
					const folded = structural[foldedAt] as Extract<SpatialEvent, { type: 'node_moved' }>
					folded.current = event.current
				}
			} else {
				structural.push(event)
			}
			continue
		}
		const key = `${event.source}\u0000${event.target}`
		const existing = byPair.get(key)
		const transition = transitionOf(event)
		if (existing === undefined) {
			pairOrder.push(key)
			byPair.set(key, {
				source: event.source,
				target: event.target,
				before: event.previous,
				after: event.current,
				transitions: [transition],
			})
		} else {
			existing.after = event.current
			if (!existing.transitions.includes(transition)) existing.transitions.push(transition)
		}
	}

	return { structural, pairs: pairOrder.map((key) => byPair.get(key)!) }
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
 * buffer is folded and handed to `onEpisode` alongside the events it was folded from, then
 * cleared for the next episode. Returns
 * a disposer that unsubscribes and cancels any pending finalize — collect it alongside
 * the other `handleMount` disposers so a React StrictMode remount can't leave two
 * recorders running.
 */
export function createEpisodeRecorder(
	stream: SpatialEventStream,
	{
		onEpisode,
		schedule = defaultSchedule,
		idleMs = EPISODE_IDLE_MS,
		bufferLimit = EPISODE_BUFFER_LIMIT,
	}: EpisodeRecorderOptions
): () => void {
	let buffer: SpatialEvent[] = []
	let cancel: (() => void) | null = null

	const pauseMs = typeof idleMs === 'function' ? idleMs : () => idleMs

	const finalize = () => {
		cancel = null
		if (buffer.length === 0) return
		const events = buffer
		buffer = []
		onEpisode(buildEpisodeSummary(events), events)
	}

	const unsubscribe = stream.subscribe((event) => {
		buffer.push(event)
		// An interaction that never pauses would otherwise grow this without bound. Dropping
		// the oldest costs the episode's earliest `before`, which is why the limit is set far
		// above any real gesture: a backstop, not a working bound.
		if (buffer.length > bufferLimit) buffer = buffer.slice(-bufferLimit)
		cancel?.()
		cancel = schedule(finalize, pauseMs())
	})

	return () => {
		unsubscribe()
		cancel?.()
		cancel = null
		buffer = []
	}
}
