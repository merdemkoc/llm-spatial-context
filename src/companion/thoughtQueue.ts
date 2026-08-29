/**
 * The queue's pure half.
 *
 * The companion no longer holds one thought and kills it when the user comes back; it holds
 * several, thinks about them at once, and speaks them in turn. That change is mostly an async
 * pump, which lives in `companion.ts` with the abort controllers and the clock. What lives
 * here is everything about the queue that is a *decision* rather than a *mechanism* — where a
 * new thought goes, whether one is still worth saying, and what to call it on screen.
 *
 * Pure and clockless, the same bargain `idleBackoff.ts` makes: handed a fold and a snapshot,
 * never reaching for a canvas or a timer, so the whole policy is arithmetic and its tests are
 * arithmetic.
 *
 * **On the two drop rules.** A queued remark can stop being worth saying in two different
 * ways, and only one of them is checkable. `isStillTrue` asks whether the *episode* still
 * reads the way it did — but the remark is free text and nothing records what it asserted, so
 * the episode is a proxy, and a blind one: it cannot see a remark about the board as a whole,
 * or one that varied its phrasing away from the change that prompted it. That is why the pump
 * puts an age cap in front of it. Age catches everything and cannot be wrong; validity catches
 * the specific, embarrassing case of describing a gesture the user has since undone.
 */
import { episodeNodes, type EpisodeSummary, type NodeId, type RelationId } from '@/domain'
import type { EpisodeContext } from '@/companion/observerClient'

/**
 * How many thoughts may be in flight at once.
 *
 * Four is not a UI choice, it is what the speech budget allows. A remark averages ~114
 * characters and the voice speaks at roughly 16 a second, so a spoken remark costs about 7s
 * plus ~1.6s of synthesis. Four deep means the last one is heard nearly thirty seconds after
 * the gesture that produced it, which is already at the edge of being worth hearing. It is
 * also the cap on paid observe calls per burst, which is why the check has to run *before*
 * the request rather than before the chip.
 */
export const QUEUE_LIMIT = 4

/**
 * How late a remark may be and still be spoken.
 *
 * Sized to the arithmetic above: a full queue puts the tail item at ~29s, so anything past
 * thirty was never going to be heard in time anyway. At the cap the last thought will
 * sometimes age out unspoken — that is the cap being honest about its own depth, not a bug,
 * and it is the reason the cap cannot simply be raised.
 */
export const MAX_REMARK_AGE_MS = 30_000

/**
 * How long the queue waits on a head that is still thinking.
 *
 * `OBSERVE_TIMEOUT_MS` is twenty seconds, which is the right ceiling for a lone request and
 * far too long to hold three remarks that are ready now. Past this the head loses its place
 * rather than the queue losing its pace; its answer, if it ever lands, finds itself gone.
 * Roughly two and a half times the 3.1s median, so a slow-but-working call still makes it.
 */
export const HEAD_OF_LINE_MS = 8_000

/**
 * The least time one remark may occupy the queue.
 *
 * With voice off — or with synthesis failing — speaking costs nothing and returns at once, so
 * without a floor the pump would empty a full queue inside a single tick: four transcript
 * entries and four chips in one frame, and slots freeing so fast that the cap never bites and
 * nothing throttles the observe rate. The companion should read as thinking either way.
 */
export const MIN_DWELL_MS = 2_000

/** Where a thought sits in the queue's own ordering. */
export type Priority = 'direct' | 'ambient'

/** Waiting on the model, waiting its turn, or holding the voice. Exactly one may speak. */
export type ThoughtState = 'thinking' | 'ready' | 'speaking'

/**
 * The separator, written as an escape rather than a literal.
 *
 * A NUL, because no `NodeId` can contain one — the same choice `canvasDiff` and
 * `effectiveStrength` make for their own pair keys. Typed out it would make this file binary
 * as far as git is concerned, and an unreadable diff is a high price for one character.
 */
const PAIR_SEPARATOR = '\u0000'

/** Directed, and keyed the same way `buildEpisodeSummary` keys its pairs, so the two agree. */
export function pairKey(source: NodeId, target: NodeId): string {
	return `${source}${PAIR_SEPARATOR}${target}`
}

/**
 * The canvas as it stands now, in the terms an episode described it in.
 *
 * Plain data, read by the adapter and judged here — the same split as `EpisodeContext`, and
 * for the same reason: looking at the canvas is a canvas concern, and deciding what the answer
 * means is not. Every field is keyed by something the episode already named, so this carries
 * a handful of numbers rather than a document.
 */
export interface EpisodeValidity {
	/**
	 * Where the episode's nodes are now — and, by omission, which of them still exist.
	 *
	 * Centres, rounded, because that is the frame `canvasDiff` reports a move in
	 * (`roundPoint(nodeCenter(node))`). A comparison against `spatial.x/y` would be a
	 * comparison between two different frames, and would mis-drop silently.
	 */
	centers: Record<NodeId, { x: number; y: number }>
	/** Current influence for the directed pairs the episode reported, keyed by `pairKey`. */
	influence: Record<string, number>
	/** Current gravity per relation the episode named. Absent means the arrow is gone. */
	gravity: Record<RelationId, number>
	/** The ends of every relation that exists right now, so a removal can be caught coming back. */
	relationEnds: { source: NodeId; target: NodeId }[]
	/** Current contextual-field radius per node the episode named. Absent means no field. */
	radius: Record<NodeId, number>
}

/** Closer to where it was than to where it went: the gesture has been reversed. */
function reverted(now: number, before: number, after: number): boolean {
	return Math.abs(now - before) < Math.abs(now - after)
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Does the board still bear this episode out?
 *
 * Asked once, at the moment the thought reaches the front of the queue — the last point at
 * which saying nothing is still free. Every check is a *reversal* test rather than an equality
 * one: carrying further in the same direction is the gesture continuing, and a remark about it
 * is more true rather than less. What cannot be checked passes, deliberately: a false drop
 * costs a remark the user would have wanted, and there are already enough ways to be silent.
 */
export function isStillTrue(summary: EpisodeSummary, now: EpisodeValidity): boolean {
	for (const event of summary.structural) {
		switch (event.type) {
			case 'node_created':
				// The idea it announced has been undone.
				if (!(event.nodeId in now.centers)) return false
				break

			case 'node_deleted':
				// "You took that one out" stops being true the moment it comes back.
				if (event.nodeId in now.centers) return false
				break

			case 'node_moved': {
				const at = now.centers[event.nodeId]
				// Gone entirely; the subject rule below decides whether that sinks the episode.
				if (!at) break
				if (reverted(distance(at, event.previous), 0, distance(event.previous, event.current))) {
					return false
				}
				break
			}

			case 'relation_created':
				if (!(event.relationId in now.gravity)) return false
				break

			case 'relation_deleted':
				if (
					now.relationEnds.some((end) => end.source === event.source && end.target === event.target)
				) {
					return false
				}
				break

			case 'relation_gravity_changed': {
				const gravity = now.gravity[event.relationId]
				if (gravity === undefined) return false
				if (reverted(gravity, event.previous, event.current)) return false
				break
			}

			case 'contextual_field_changed': {
				// Absent and zero are different states in the model, but not for this question:
				// either way the field reaches nowhere, which is what the remark was about.
				const radius = now.radius[event.nodeId] ?? 0
				if (reverted(radius, event.previous ?? 0, event.current ?? 0)) return false
				break
			}
		}
	}

	for (const pair of summary.pairs) {
		// Absent because a node went: influence to a node that is not there is zero, and the
		// reversal test reads that correctly without a special case.
		const influence = now.influence[pairKey(pair.source, pair.target)] ?? 0
		if (reverted(influence, pair.before.influence, pair.after.influence)) return false
	}

	// Every idea it was about has gone. One survivor is enough — a remark about three notes
	// where one was deleted is arguably more interesting, not less — but naming a board where
	// none of them remain is the worst failure available.
	const deleted = new Set(
		summary.structural
			.filter((event) => event.type === 'node_deleted')
			.map((event) => event.nodeId as NodeId)
	)
	const subjects = episodeNodes(summary).filter((id) => !deleted.has(id))
	if (subjects.length > 0 && subjects.every((id) => !(id in now.centers))) return false

	return true
}

/**
 * Where a new thought goes.
 *
 * Two rules, and the second is the one that matters. A direct request — the user pressing
 * Reflect, or accepting a grouping — goes ahead of the ambient observations it interrupts,
 * because it is an answer to a question just asked and they are remarks nobody asked for. But
 * nothing goes ahead of a remark already being spoken: cutting a sentence off mid-word is the
 * one thing the queue never does, so a direct request takes the next turn, not this one.
 *
 * Ties keep their arrival order, so two direct requests are answered in the order they were
 * made rather than in reverse.
 */
export function insertByPriority<T extends { priority: Priority; state: ThoughtState }>(
	queue: readonly T[],
	thought: T
): T[] {
	if (thought.priority === 'ambient') return [...queue, thought]

	const at = queue.findIndex((held) => held.state !== 'speaking' && held.priority === 'ambient')
	if (at === -1) return [...queue, thought]
	return [...queue.slice(0, at), thought, ...queue.slice(at)]
}

/** Long enough to recognise the note, short enough that four of them fit across a canvas. */
const LABEL_MAX = 15

function quote(text: string): string {
	const trimmed = text.trim()
	return trimmed.length <= LABEL_MAX
		? `“${trimmed}”`
		: `“${trimmed.slice(0, LABEL_MAX).trimEnd()}…”`
}

/**
 * What to call this thought on its chip.
 *
 * The queue is only legible as *your* gestures if the chips name them, and an episode names
 * nodes by `NodeId` — a chip reading `shape:V1StGXR8` names nothing. So the labels the
 * observer was given come along, captured at send time rather than re-read, so the chip says
 * what the thought was about rather than what the canvas has since become.
 *
 * One line of precedence, and it follows the significance gate's: an explicit relation or a
 * new idea outranks the moves around it, because that is the part of the episode a remark is
 * most likely to be about. Falls back to counting when a note has no text yet, since a blank
 * post-it is common and an empty pair of quotes reads as a bug.
 */
export function describeGesture(summary: EpisodeSummary, context: EpisodeContext): string {
	const name = (id: NodeId | undefined): string | null => {
		const text = id === undefined ? undefined : context.labels[id]
		return text ? quote(text) : null
	}

	for (const event of summary.structural) {
		switch (event.type) {
			case 'relation_created': {
				const from = name(event.source)
				const to = name(event.target)
				return from && to ? `linked ${from} → ${to}` : 'drew an arrow'
			}
			case 'relation_deleted': {
				const from = name(event.source)
				return from ? `unlinked ${from}` : 'removed an arrow'
			}
			case 'relation_rebound':
				return 'moved an arrow'
			case 'relation_gravity_changed':
				return 'reweighted a link'
			case 'node_created': {
				const who = name(event.nodeId)
				return who ? `added ${who}` : 'added an idea'
			}
			case 'node_deleted': {
				const who = name(event.nodeId)
				return who ? `removed ${who}` : 'removed an idea'
			}
			case 'contextual_field_changed': {
				const who = name(event.nodeId)
				return who ? `resized ${who}` : 'resized a field'
			}
		}
	}

	const moved = summary.structural.filter((event) => event.type === 'node_moved')
	if (moved.length === 1) {
		const who = name(moved[0].nodeId)
		return who ? `moved ${who}` : 'moved 1 note'
	}
	if (moved.length > 1) return `moved ${moved.length} notes`

	const pair = summary.pairs[0]
	if (pair) {
		const from = name(pair.source)
		const to = name(pair.target)
		if (from && to) return `${from} and ${to}`
		return summary.pairs.length === 1 ? '2 ideas shifted' : `${summary.pairs.length} pairs shifted`
	}

	return 'a change'
}
