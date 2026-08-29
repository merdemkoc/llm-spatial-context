/**
 * The companion orchestrator — the loop, wired.
 *
 *   observe → detect meaningful change → think → queue → speak
 *
 * It owns an `EpisodeRecorder` over the spatial event stream and, for each finalized
 * episode, runs the second stage of the significance model: the local gate
 * (`isTrivialEpisode`) has already dropped the noise, so anything that reaches here is
 * worth *asking* about — but the model still decides whether it is worth *speaking*
 * about. A silent verdict is a first-class outcome, not a failure.
 *
 * **The companion holds a queue, not a thought.** It used to hold one, and kill it the moment
 * the user came back: an answer about a canvas that has moved on is worse than silence, so a
 * gesture interrupted mid-thought produced nothing at all. That is a defensible bet and it was
 * the wrong one. Keep arranging and the companion had nothing to say about any of it except
 * the last thing you did. So the pipeline now behaves like a queue of tasks: every gesture
 * gets a slot, the thinking happens in parallel, and the remarks are spoken one after another
 * in the order the gestures happened. Watching it work through three things it noticed is more
 * companionable than watching it forget two of them.
 *
 * Four consequences, and together they are most of what this file does:
 *
 *   - **The pump is the only thing that speaks.** Not a convention — a structural guarantee.
 *     Observation, the proactive grouping, an on-demand reflection and the comment after an
 *     accepted edit all *enqueue*; none of them touch `voice`. Two of those used to speak
 *     directly, which under a queue means two clips talking over each other and a pump waiting
 *     on a clip that was silently replaced.
 *   - **A remark can still be dropped, but at the door rather than in flight.** Two rules, and
 *     age comes first because it is the only one that cannot be wrong: a remark thirty seconds
 *     behind the board is not worth hearing whatever it says. `isStillTrue` is the second, and
 *     narrower — it catches the specific embarrassment of describing a gesture since undone.
 *   - **Nothing interrupts a remark being spoken.** Cutting a sentence off mid-word was already
 *     the thing this loop refused to do; with a queue it falls out for free, because the next
 *     remark cannot start until the previous one reports that it is over.
 *   - **The pause still learns, from a narrower signal.** `createIdleBackoff` existed to make
 *     kills rarer, and nothing is killed now. But it is also the only thing throttling how many
 *     paid observe calls a fidget costs, so it stays — retriggered by the one pair of
 *     conditions that still means "the pause was too short": a thought dropped as no longer
 *     true, *and* a user who came straight back after the pause fired. Either alone says
 *     something else.
 *
 * **Text arrives with the voice.** Deciding what to say and synthesizing it are two waits,
 * a second or three each. Announcing the remark after the first one meant the user read it,
 * finished, and only then heard it read aloud — so the thinking hint stays up through
 * synthesis and the words are released as playback reports them (`companionUtterance`). The
 * transcript is written as the remark takes the head, not when the model answered: a thought
 * dropped at the door was never said, and one that appeared in the transcript would show up in
 * the bar and in the next prompt's anti-repetition regardless.
 *
 * The clients and the timers are injected; nothing here reaches the network directly.
 */
import { react } from 'tldraw'
import {
	buildEpisodeSummary,
	createEpisodeRecorder,
	createIdleBackoff,
	episodeNodes,
	EPISODE_BUFFER_LIMIT,
	EPISODE_IDLE_MS,
	isTrivialEpisode,
	type BoardSummary,
	type ClusterPlacement,
	type EpisodeSummary,
	type NodeId,
	type Schedule,
	type SpatialEvent,
	type SpatialEventStream,
} from '@/domain'
import type { EpisodeContext, ObserverClient } from '@/companion/observerClient'
import type { GroupingProposal, SuggestClient } from '@/companion/suggestClient'
import type { IdeaProposal, ReflectClient, Reflection } from '@/companion/reflectClient'
import type { VoiceClient } from '@/companion/voiceClient'
import {
	describeGesture,
	insertByPriority,
	isStillTrue,
	HEAD_OF_LINE_MS,
	MAX_REMARK_AGE_MS,
	MIN_DWELL_MS,
	QUEUE_LIMIT,
	type EpisodeValidity,
	type Priority,
	type ThoughtState,
} from '@/companion/thoughtQueue'
import {
	companionFocus,
	companionPacing,
	companionQueue,
	companionStage,
	companionTranscript,
	companionUtterance,
	groupingSuggestion,
	ideaSuggestions,
	observationEnabled,
	relationSuggestions,
	voiceEnabled,
	type GhostIdea,
	type GhostRelation,
} from '@/companion/companionState'

/** How many recent comments to hand the model for anti-repetition. */
export const DEFAULT_HISTORY_SIZE = 3

/** Cap on retained transcript entries, so a long session doesn't grow unbounded. */
export const TRANSCRIPT_LIMIT = 50

/**
 * How long to wait between unprompted grouping proposals. A proactive suggestion is more
 * assertive than a remark — it puts a ghost on the canvas — so it must be rare. The
 * on-demand button bypasses this entirely.
 */
export const PROACTIVE_COOLDOWN_MS = 60_000

/** Small slack added to the self-edit window so scheduling jitter can't leak the move through. */
const AGENT_EDIT_GRACE_MS = 250

/**
 * How soon after an episode closes a return counts as *straight* back.
 *
 * Half the resting pause. The pacing policy wants the case where the quiet it waited out was
 * not the end of the gesture, and a user who resumes within this window plainly had not
 * finished. A return a full second or more later is a new gesture, and a thought that goes
 * stale because of one says nothing about how long the pause should have been.
 */
const PROMPT_RETURN_MS = 600

/**
 * The last resort behind a clip that never reports itself finished.
 *
 * `VoiceClient` makes `onEnd` total, so every ending anyone has thought of already arrives —
 * this is for the ones nobody has. A stalled stream fires neither `ended` nor `error`, and the
 * pump waits on exactly one promise, so the cost of being wrong here is a companion that never
 * speaks again. Far above the longest possible clip (`MAX_SPEAK_CHARS` is 600 characters, about
 * 37 seconds of speech) so it can only ever fire on something genuinely broken.
 */
const PLAYBACK_WATCHDOG_MS = 60_000

const defaultDelay: Schedule = (fn, ms) => {
	const id = setTimeout(fn, ms)
	return () => clearTimeout(id)
}

/** A concrete grouping: the members to move and where. Mirrors the adapter's `GroupingPlan`. */
export interface CompanionGroupingPlan {
	members: NodeId[]
	targets: ClusterPlacement[]
}

export interface CompanionOptions {
	stream: SpatialEventStream
	observer: ObserverClient
	voice: VoiceClient
	/** Timer for episode finalization; forwarded to the recorder. */
	schedule?: Schedule
	/**
	 * Timer for the queue's own pacing — the minimum dwell and the playback watchdog.
	 *
	 * Separate from `schedule` because the two answer to different things and a test that
	 * drives one should not be arming the other: `schedule` decides when a gesture is over,
	 * this decides how fast the queue may drain.
	 */
	delay?: Schedule
	/** The least time one remark occupies the queue. Defaults to `MIN_DWELL_MS`; 0 disables it. */
	minDwellMs?: number
	/**
	 * The pause an episode *rests* at before finalizing. Defaults to `EPISODE_IDLE_MS`.
	 *
	 * Not the pause actually waited out: that is `createIdleBackoff`'s, which starts here,
	 * rises when a gesture turns out to have been misread as finished, and returns here.
	 */
	idleMs?: number
	/** Clock for transcript timestamps and queue ages. Injected so tests are deterministic. */
	now?: () => number
	/** Recent comments passed to the observer. Defaults to `DEFAULT_HISTORY_SIZE`. */
	historySize?: number
	/**
	 * What the episode's node ids refer to, resolved at send time.
	 *
	 * The domain deals in `NodeId`s; the observer needs the note text behind them and the
	 * relations that already exist. Injected rather than imported because reading either
	 * means reading the canvas, which the domain must not do — the adapter supplies it.
	 */
	context?: (summary: EpisodeSummary) => EpisodeContext
	/**
	 * The whole board as background for the observer's remark, and the input the suggester
	 * reasons over. Injected for the same reason as `context`: it reads the canvas, so the
	 * adapter supplies it. Whole-board, not episode-specific, so it takes no argument.
	 */
	board?: () => BoardSummary
	/**
	 * The board as it stands now, in the terms one episode described it in — read just before
	 * that episode's remark is spoken, so a gesture the user has since undone can be caught.
	 *
	 * Injected like `context`, and optional for the same reason a fake observer is: without it
	 * the queue simply does not run the second drop rule. The age cap still applies, so an
	 * un-injected companion is late-tolerant rather than unguarded.
	 */
	verify?: (summary: EpisodeSummary) => EpisodeValidity
	/**
	 * The grouping suggester. Optional: without it the companion only observes. Consulted
	 * on demand, and proactively after a silent observation when the board warrants it.
	 */
	suggest?: SuggestClient
	/**
	 * Turn the model's chosen member ids into a concrete plan (targets computed from the live
	 * layout). Injected like `context`, because the geometry reads the canvas. Returns `null`
	 * when fewer than two members survive.
	 */
	planGrouping?: (memberIds: NodeId[]) => CompanionGroupingPlan | null
	/**
	 * Commit an accepted grouping — reposition the members — and report how many moved.
	 * Injected because the write reaches the canvas; the companion owns only the comment on the
	 * result and the suppression of its own follow-up episode.
	 */
	applyGrouping?: (plan: CompanionGroupingPlan) => number
	/**
	 * Whether a proactive grouping is due this episode. Injected so tests are deterministic;
	 * the default is a cooldown so the companion doesn't nag.
	 */
	shouldProposeGrouping?: (summary: EpisodeSummary, now: number) => boolean
	/**
	 * The whole-board reflection. Optional: without it the "Reflect" action does nothing.
	 * Consulted only on demand.
	 */
	reflect?: ReflectClient
	/**
	 * Turn the reflection's proposed note texts into ghost ideas placed in open space. Injected
	 * like `planGrouping`, because the placement reads the canvas.
	 */
	planIdeas?: (proposals: IdeaProposal[]) => GhostIdea[]
	/**
	 * Commit chosen ideas as agent-stamped notes, returning the new notes' ids in order — the
	 * companion needs them to draw any arrows to a fresh note. Injected because the write reaches
	 * the canvas.
	 */
	createAgentNotes?: (notes: { text: string; x: number; y: number }[]) => NodeId[]
	/**
	 * Draw agent-authored arrows between existing notes, reporting how many drew. Injected because
	 * the write reaches the canvas.
	 */
	createAgentRelations?: (relations: { from: NodeId; to: NodeId; label?: string }[]) => number
}

/** The running companion. `dispose` tears it down; the rest are the canvas AI controls' handles. */
export interface Companion {
	dispose: () => void
	/** Ask for a grouping organised by `context` — the "✦ Suggest a grouping" button's prompt. */
	requestGrouping: (context: string) => void
	/** Commit the pending grouping, affirm it, and swallow the resulting self-edit episode. */
	acceptGrouping: () => void
	/** Reflect on the whole board through `persona` — the "✦ Reflect" button's chosen lens. */
	requestReflection: (persona: string) => void
	/** Commit the named ghost ideas as agent-stamped notes, and swallow the self-edit episode. */
	commitIdeas: (ideaIds: string[]) => void
	/** Commit the named ghost relations as agent-drawn arrows, and swallow the self-edit episode. */
	commitRelations: (relationIds: string[]) => void
	/** Drop a queued thought before it is spoken — the × on its chip. */
	cancelThought: (id: number) => void
}

const EMPTY_CONTEXT: EpisodeContext = { labels: {}, relations: [] }

/**
 * One thing the companion has to say, from the moment its episode closed until it is spoken
 * or dropped.
 *
 * Deliberately not a generation number. A single counter answers "is this the newest thought",
 * which was the right question when there was only ever one; with several in flight the
 * question is "is *this* thought still wanted", which is identity, not recency. The old
 * counter would have discarded every answer but the last, which is the behaviour the queue
 * exists to replace — while still paying for all of them.
 */
interface QueuedThought {
	/** Stable for the chip's React key and for cancelling by id. Monotonic within a mount. */
	id: number
	priority: Priority
	state: ThoughtState
	/** What the user did, in a few words — the chip's label, computed once at enqueue. */
	gesture: string
	/**
	 * The fold the observer saw. `null` for a thought with no episode behind it: a reflection
	 * is about the whole board, and there is nothing in an episode that could contradict it.
	 */
	summary: EpisodeSummary | null
	/** The events behind it, so a dropped thought's gesture is not lost. */
	events: SpatialEvent[]
	/** The notes the remark is about — highlighted on the canvas while it is spoken. */
	focus: NodeId[]
	/** The clock at episode close: the age the pump refuses to speak past. */
	closedAt: number
	/** The pause the recorder had actually waited out to close that episode. */
	idleAtClose: number
	/** When the user first came back after it closed. `null` while they have not. */
	returnedAt: number | null
	/** Calls off the model. Aborted by cancel and teardown; never by the user touching the canvas. */
	controller: AbortController
	/** The sentence, once the model has decided on one. `null` while thinking. */
	comment: string | null
	/**
	 * The side effect that must land with the voice, if any — putting a grouping ghost or a set
	 * of idea ghosts on the canvas. Run as the thought takes the head, so the preview is on
	 * screen as the rationale is spoken rather than a beat before it.
	 */
	stage?: () => void
}

/**
 * Start the companion over a stream. Returns a disposer that stops the recorder, drains the
 * queue and aborts every request in it — collect it with the other `handleMount` disposers.
 */
export function createCompanion({
	stream,
	observer,
	voice,
	schedule,
	delay = defaultDelay,
	minDwellMs = MIN_DWELL_MS,
	idleMs,
	now = Date.now,
	historySize = DEFAULT_HISTORY_SIZE,
	context,
	board,
	verify,
	suggest,
	planGrouping,
	applyGrouping,
	shouldProposeGrouping,
	reflect,
	planIdeas,
	createAgentNotes,
	createAgentRelations,
}: CompanionOptions): Companion {
	/** Oldest turn first. The head is the only thought that may speak. */
	let queue: QueuedThought[] = []
	let nextId = 1
	/** The pump's mutual exclusion: exactly one remark is being spoken at a time. */
	let pumping = false
	/**
	 * Who owns the utterance atoms.
	 *
	 * All that survives of the old generation counter, doing the one job it was actually right
	 * for. Bumped as each remark takes the voice, so a stale clip's progress callback cannot
	 * overwrite the sentence that replaced it.
	 */
	let speechGeneration = 0
	let disposed = false
	// When set to a future time, episodes finalizing before it are the companion's own
	// grouping move and are skipped rather than narrated.
	let agentEditUntil = 0
	// When the last proactive proposal was made, for the cooldown between them.
	let lastProactiveAt = 0
	/** The in-flight request of whichever direct thought is thinking, so a newer one supersedes it. */
	let inFlight: AbortController | null = null
	/** Cancels the pump's own wake-up, when it is waiting on nothing but the clock. */
	let cancelWake: (() => void) | null = null

	const shouldPropose =
		shouldProposeGrouping ?? ((_summary, at) => at - lastProactiveAt >= PROACTIVE_COOLDOWN_MS)

	/**
	 * An arc the queue could not take yet, waiting to be folded into the next thought.
	 *
	 * Three things put events here and they are the same thing wearing different hats: an
	 * episode too trivial to send on its own while an arc is already open, a gesture made while
	 * a proposal is waiting to be decided, and a gesture that arrived with the queue full.
	 * In every case the events are not lost — they ride along with the next episode and are
	 * re-folded, so the observer sees the whole arc rather than the fragment after the pause.
	 *
	 * Owned by whoever consumes it and nobody else. It used to be cleared in `settle`, which is
	 * per-thought now: one remark finishing would have wiped an arc belonging to a later one.
	 */
	let carried: SpatialEvent[] = []
	/** Thoughts thrown away at the door. Reported, not acted on. */
	let dropped = 0

	const backoff = createIdleBackoff({ baseMs: idleMs })

	/**
	 * The pause the recorder last armed.
	 *
	 * Read back at episode close to measure the quiet that produced it. The policy can move
	 * between the timer being armed and its firing — a previous thought landing walks the
	 * pause down — and it is the value actually waited out, not the current one, that says
	 * whether it was long enough.
	 */
	let armedIdleMs = backoff.currentMs()
	const nextIdleMs = () => {
		armedIdleMs = backoff.currentMs()
		return armedIdleMs
	}

	const publishPacing = () => {
		companionPacing.set({ idleMs: backoff.currentMs(), dropped })
	}

	/** A proposal is on the canvas awaiting a decision; the companion never talks over one. */
	const proposalPending = () =>
		groupingSuggestion.get() !== null ||
		ideaSuggestions.get().length > 0 ||
		relationSuggestions.get().length > 0

	/**
	 * Mirror the queue for the chip row, and derive the thinking hint from the head.
	 *
	 * The hint has to come from the head alone, not from the queue as a whole. `CompanionBar`
	 * hides the remark whenever the stage is anything but idle, so a second thought thinking in
	 * the background would blank the sentence being spoken in the foreground — the word-by-word
	 * reveal would vanish exactly when the queue is deep enough to be interesting. Background
	 * work belongs on the chips; the hint is about the thing you are waiting to hear.
	 */
	const publishQueue = () => {
		companionQueue.set(
			queue.map((thought) => ({ id: thought.id, gesture: thought.gesture, state: thought.state }))
		)
		const head = queue[0]
		// While the head speaks, `utter` owns the stage: 'composing' through synthesis, then
		// 'idle' as the voice comes up so the bar can start showing words.
		if (head?.state === 'speaking') return
		// Only a head actually waiting on the model earns the hint. A head that has its sentence
		// and is merely held — behind a ghost awaiting a decision — is not working, and a hint
		// that says it is turns "nothing is happening" into a claim that something is.
		companionStage.set(head?.state === 'thinking' ? 'observing' : 'idle')
	}

	const remove = (thought: QueuedThought) => {
		queue = queue.filter((held) => held !== thought)
	}

	/**
	 * A thought reached its end and nothing cut it short — it was spoken, or it had nothing to
	 * say. Either way the quiet it waited out was long enough, so the policy hands back half of
	 * whatever penalty it is carrying.
	 */
	const settle = () => {
		backoff.settled()
		publishPacing()
	}

	/**
	 * The user is back.
	 *
	 * It used to kill whatever was in flight. It now only writes down when the return happened,
	 * because that timestamp is half of the one signal the pacing policy still learns from — the
	 * other half being whether the thought later turned out to be about a board that had moved
	 * on. A return on its own means nothing: users come back to a canvas all the time and most
	 * remarks survive it.
	 */
	const handleActivity = () => {
		if (queue.length === 0) return
		const at = now()
		for (const thought of queue) {
			if (thought.returnedAt === null) thought.returnedAt = at
		}
	}

	/**
	 * Recent comments for anti-repetition, from the transcript *and* the queue.
	 *
	 * The transcript alone is not enough once thoughts think in parallel: it is written as a
	 * remark takes the voice, so two requests a second apart would both be told the same last
	 * three things and could easily arrive at the same fourth. The queue holds what has been
	 * decided but not yet said, which is exactly the gap. Sliced once over the concatenation
	 * rather than once per source, so a full queue doesn't quietly change the prompt's shape.
	 */
	const recentComments = () =>
		[
			...companionTranscript.get().map((entry) => entry.comment),
			// The speaking one has already been recorded; including it would say it twice.
			...queue
				.filter((thought) => thought.comment !== null && thought.state !== 'speaking')
				.map((thought) => thought.comment!),
		].slice(-historySize)

	const record = (comment: string) => {
		const next = [...companionTranscript.get(), { comment, at: now() }]
		companionTranscript.set(next.slice(-TRANSCRIPT_LIMIT))
	}

	/**
	 * This thought will not be spoken.
	 *
	 * Two reasons reach here and only one of them teaches the pause anything. A thought dropped
	 * as no longer true, by a user who came straight back after the pause fired, is the pause
	 * having been too short — that is the pair of conditions, and neither half means it alone.
	 * A thought dropped for being late says the queue was deep; a stale one the user wandered
	 * back to a minute later says the board moved on. Both are real, neither is about timing.
	 */
	const drop = (thought: QueuedThought, reason: 'late' | 'stale') => {
		thought.controller.abort()
		remove(thought)
		dropped += 1

		const returnedPromptly =
			thought.returnedAt !== null && thought.returnedAt - thought.closedAt <= PROMPT_RETURN_MS
		if (reason === 'stale' && returnedPromptly) {
			// The quiet that fooled us, measured rather than guessed: what the recorder waited
			// out, plus how long the user stayed away after it fired.
			backoff.interrupted(thought.idleAtClose + (thought.returnedAt! - thought.closedAt))
		}

		publishPacing()
		publishQueue()
	}

	/**
	 * Is this still worth saying, at the last moment saying nothing is free?
	 *
	 * Age first, because it is the only rule that cannot be wrong. Nothing records what the
	 * remark actually asserted — it is free text — so `isStillTrue` reads the *episode* as a
	 * proxy, and the proxy is blind to a remark about the board as a whole or one that varied
	 * its phrasing away from the change that prompted it. Age catches all of those. A direct
	 * request skips both: the user asked for it, and a reflection is about a board rather than
	 * about a gesture that could be undone.
	 */
	const stillWorthSaying = (thought: QueuedThought): boolean => {
		if (thought.priority === 'direct') return true
		if (now() - thought.closedAt > MAX_REMARK_AGE_MS) return false
		if (!verify || !thought.summary) return true
		return isStillTrue(thought.summary, verify(thought.summary))
	}

	/**
	 * Speak one remark and resolve when it is over — however it ends.
	 *
	 * This await is the only thing pacing the queue, so a promise that can fail to settle is a
	 * queue that can fail to drain. `VoiceClient` makes `onEnd` total for exactly that reason,
	 * and the watchdog covers the endings nobody has thought of yet.
	 *
	 * The dwell is the other half. With voice off — or with synthesis failing — speaking costs
	 * nothing and returns at once, so without a floor the pump would empty a full queue inside
	 * one tick: four transcript entries in a single frame, and slots freeing so fast that
	 * nothing throttles the observe rate behind them.
	 */
	const utter = (thought: QueuedThought) =>
		new Promise<void>((resolve) => {
			speechGeneration += 1
			const mine = speechGeneration
			const owns = () => mine === speechGeneration && !disposed

			const comment = thought.comment ?? ''
			let settled = false
			let over = false
			let dwelt = minDwellMs <= 0
			let cancelWatchdog: (() => void) | null = null

			const finish = () => {
				if (settled || !over || !dwelt) return
				settled = true
				cancelWatchdog?.()
				resolve()
			}
			const ended = () => {
				over = true
				finish()
			}

			if (!dwelt) {
				delay(() => {
					dwelt = true
					finish()
				}, minDwellMs)
			}

			if (!voiceEnabled.get()) {
				// Nothing to wait for, so the remark is the whole remark, immediately. Nothing is
				// being spoken, so there is nothing to highlight either.
				companionStage.set('idle')
				ended()
				return
			}

			companionStage.set('composing')
			void voice
				.speak(comment, {
					signal: thought.controller.signal,
					onStart: () => {
						if (!owns()) return
						// The hint comes down exactly as the voice comes up: one hands over to the
						// other, so there is never a silent sentence sitting on screen. The notes the
						// remark is about light up for as long as it is spoken.
						companionStage.set('idle')
						companionUtterance.set({ comment, fraction: 0 })
						companionFocus.set(thought.focus)
						cancelWatchdog = delay(ended, PLAYBACK_WATCHDOG_MS)
					},
					onProgress: (fraction) => {
						if (!owns()) return
						if (fraction >= 1) {
							companionUtterance.set(null)
							companionFocus.set([])
						} else {
							companionUtterance.set({ comment, fraction })
						}
					},
					onEnd: () => {
						if (owns()) {
							companionStage.set('idle')
							companionUtterance.set(null)
							companionFocus.set([])
						}
						ended()
					},
				})
				.catch(() => {
					// A blocked or failed playback shouldn't take down the loop — and it must not
					// leave the remark hidden behind a thinking hint that will never clear either.
					// `onEnd` has already reported the ending; the client makes that total.
					if (owns()) {
						companionStage.set('idle')
						companionUtterance.set(null)
						companionFocus.set([])
					}
				})
		})

	/**
	 * The one place a remark becomes sound.
	 *
	 * A single loop, and the single owner of `voice`, because both of the queue's promises are
	 * statements about a sequence: remarks are heard in the order the gestures happened, and
	 * exactly one is heard at a time. Anything able to speak without coming through here breaks
	 * both, which is why the proactive grouping and the on-demand reflection are queue items
	 * that jump the line rather than speakers that talk beside it.
	 *
	 * Called from everywhere a thought might have become speakable — an answer arriving, a
	 * cancel, a clip ending, a proposal decided — and every call but the first returns at once.
	 */
	const pump = async (): Promise<void> => {
		if (pumping || disposed) return
		pumping = true
		try {
			for (;;) {
				const head = queue[0]
				if (!head || head.state === 'speaking') break

				if (head.state === 'thinking') {
					// A slow head only costs anything while something behind it is ready and going
					// stale, so that is the only case this deadline applies to — a lone thought
					// keeps the observer's own twenty-second patience, because dropping it early
					// would lose an answer and gain nobody anything. When it *is* holding up a
					// remark, though, twenty seconds is far too long, so past this it loses its
					// place rather than the queue losing its pace. A direct request is exempt: the
					// user asked for it and is waiting on this specific answer.
					const blocking = queue.some((held) => held !== head && held.state === 'ready')
					if (!blocking || head.priority === 'direct') break
					if (now() - head.closedAt < HEAD_OF_LINE_MS) break
					drop(head, 'late')
					continue
				}

				// Asked before the hold below, not after. A remark held behind a ghost is exactly
				// the one most likely to go stale, and a hold that came first would mean the age
				// cap could never reach it — it would wait for a decision that might never come,
				// and speak whenever it finally did, however long that took.
				if (!stillWorthSaying(head)) {
					drop(head, 'stale')
					continue
				}

				// Never talk over a pending ghost. Checked here and not only at enqueue, because
				// a proposal can appear after a thought was queued.
				if (head.priority === 'ambient' && proposalPending()) break

				head.state = 'speaking'
				publishQueue()
				// The ghost first, so the preview is on screen as the rationale is spoken; then
				// the transcript, then the voice.
				head.stage?.()
				record(head.comment!)

				await utter(head)

				remove(head)
				settle()
				publishQueue()
				if (disposed) break
			}
		} finally {
			pumping = false
			// Whatever the loop did, it may have freed a slot — a remark spoken, a thought
			// dropped, one abandoned for having nothing to say. Any of those is the moment an
			// arc waiting for room can take it.
			flushCarried()
			rearm()
		}
	}

	/**
	 * Come back when the clock alone would change the answer.
	 *
	 * The pump is otherwise woken by events — an answer arriving, a clip ending, a proposal
	 * decided — and there are two places it stops where no event is coming. A head still
	 * thinking while remarks queue behind it, and a head holding its sentence behind a ghost
	 * nobody has decided. Both are supposed to end in a drop, and both would instead wait for
	 * ever: the deadline that drops them is only read inside the loop, and nothing re-enters it.
	 *
	 * Armed only for a deadline in the future, which is what keeps this from spinning: a head
	 * already past its deadline would have been dropped rather than reaching here.
	 */
	const rearm = () => {
		cancelWake?.()
		cancelWake = null

		const head = queue[0]
		if (!head || head.state === 'speaking' || disposed) return

		let deadline: number | null = null
		if (head.state === 'thinking') {
			// Only when it is actually in the way. On its own it keeps the observer's ceiling,
			// and that request will resolve or reject without any help from here.
			const blocking = queue.some((held) => held !== head && held.state === 'ready')
			if (blocking && head.priority !== 'direct') deadline = head.closedAt + HEAD_OF_LINE_MS
		} else if (head.priority === 'ambient' && proposalPending()) {
			deadline = head.closedAt + MAX_REMARK_AGE_MS
		}
		if (deadline === null) return

		cancelWake = delay(
			() => {
				cancelWake = null
				void pump()
			},
			Math.max(0, deadline - now())
		)
	}

	/**
	 * A slot has freed and an arc is waiting for one.
	 *
	 * Without this, overflow would only ever drain when the recorder next closes an episode —
	 * so a burst that ends in stillness, which is what the end of a burst *is*, would strand its
	 * own tail forever.
	 */
	const flushCarried = () => {
		if (disposed || carried.length === 0 || queue.length >= QUEUE_LIMIT) return
		const events = carried
		handleEpisode(buildEpisodeSummary(events), events)
	}

	/** Put a thought in the queue and let the chips and the pump know. */
	const enqueue = (thought: QueuedThought) => {
		queue = insertByPriority(queue, thought)
		publishQueue()
		return thought
	}

	const newThought = (fields: Partial<QueuedThought> & { priority: Priority }): QueuedThought => ({
		id: nextId++,
		state: 'thinking',
		gesture: 'thinking',
		summary: null,
		events: [],
		focus: [],
		closedAt: now(),
		idleAtClose: armedIdleMs,
		returnedAt: null,
		controller: new AbortController(),
		comment: null,
		...fields,
	})

	/** The model has decided; hand the sentence to the queue. */
	const ready = (thought: QueuedThought, comment: string, focus: NodeId[], stage?: () => void) => {
		thought.comment = comment
		thought.focus = focus
		if (stage) thought.stage = stage
		thought.state = 'ready'
		publishQueue()
		void pump()
	}

	/** Nothing to say, or nothing came back. Give up the slot. */
	const abandon = (thought: QueuedThought) => {
		remove(thought)
		publishQueue()
		void pump()
	}

	/**
	 * Ask the observer about one episode.
	 *
	 * Runs beside its siblings rather than superseding them: whether the answer is still wanted
	 * is a question about *this* thought — is it still in the queue — not about whether a newer
	 * one exists. That distinction is the whole of "parallel think": a recency check here would
	 * discard every answer but the last while still paying for all of them.
	 */
	const think = async (thought: QueuedThought) => {
		// Built once and shared: the observer reads it as context, and a proactive suggestion
		// reuses it rather than reading the canvas twice.
		const boardSummary = board?.()

		let decision = null as Awaited<ReturnType<ObserverClient['observe']>> | null
		try {
			decision = await observer.observe(
				{
					episode: thought.summary!,
					context: context?.(thought.summary!) ?? EMPTY_CONTEXT,
					recentComments: recentComments(),
					board: boardSummary,
				},
				thought.controller.signal
			)
		} catch {
			// Cancelled, dropped for being late, or the request failed — either way, nothing.
		}

		// Cancelled while we waited, or the pump gave its place away. Torn down, likewise.
		if (disposed || !queue.includes(thought)) return

		const silent = !decision || !decision.speak || !decision.comment
		// Re-read the switch rather than trusting the check made before the await: a user
		// who switches observation off mid-thought is asking not to be spoken to, and the
		// answer in hand was authorised by a setting that no longer holds.
		if (silent || !observationEnabled.get()) {
			// The thought reached its end — silence is a first-class outcome — so the pause it
			// waited out was long enough and the policy hands back half its penalty.
			abandon(thought)
			settle()
			// The observer had nothing to say. This is the one moment a proactive grouping
			// fits: silence, plus a board with a few scattered ideas, plus the cooldown
			// elapsed. It never stacks on top of a remark, and the model's own high bar
			// declines most of the time regardless.
			if (
				silent &&
				observationEnabled.get() &&
				suggest &&
				planGrouping &&
				boardSummary &&
				boardSummary.nodeCount >= 3 &&
				boardSummary.loners.length >= 2 &&
				shouldPropose(thought.summary!, now())
			) {
				void runSuggestion('proactive', boardSummary)
			}
			return
		}

		ready(thought, decision!.comment!, episodeNodes(thought.summary!))
	}

	/**
	 * Ask the suggester for a grouping and, if one comes back, queue the rationale with the
	 * ghost that goes on the canvas as it is spoken.
	 *
	 * A proactive proposal is ambient — it waits its turn behind the observations already in the
	 * queue, because nobody asked for it. One requested from the toolbar is direct and jumps.
	 */
	const runSuggestion = async (
		trigger: 'demand' | 'proactive',
		boardSummary: BoardSummary | undefined,
		intent?: string
	) => {
		if (!suggest || !planGrouping || !boardSummary) return

		const thought = enqueue(
			newThought({
				priority: trigger === 'demand' ? 'direct' : 'ambient',
				gesture: intent ? `grouping by ${intent}` : 'a grouping',
			})
		)
		inFlight?.abort()
		inFlight = thought.controller
		// Count the cooldown from the attempt, not just a success, so repeated declines on a
		// quiet canvas can't hammer the API.
		if (trigger === 'proactive') lastProactiveAt = now()

		let proposal: GroupingProposal | null = null
		try {
			proposal = await suggest.suggest(
				{ board: boardSummary, trigger, recentComments: recentComments(), intent },
				thought.controller.signal
			)
		} catch {
			// Cancelled, superseded, or the request failed — either way, no proposal.
		}

		if (disposed || !queue.includes(thought)) return
		if (inFlight === thought.controller) inFlight = null

		const plan =
			proposal && proposal.members.length >= 2 && proposal.rationale
				? planGrouping(proposal.members)
				: null
		if (!plan) {
			abandon(thought)
			return
		}

		const rationale = proposal!.rationale
		ready(thought, rationale, plan.members, () =>
			groupingSuggestion.set({ members: plan.members, targets: plan.targets, rationale })
		)
	}

	/**
	 * Reflect on the whole board: a spoken reading of it, plus a few new notes ghosted in open
	 * space to accept or dismiss. On demand only, so it jumps the line.
	 */
	const runReflection = async (boardSummary: BoardSummary | undefined, persona: string) => {
		if (!reflect || !planIdeas || !boardSummary) return

		const thought = enqueue(newThought({ priority: 'direct', gesture: `reflecting · ${persona}` }))
		inFlight?.abort()
		inFlight = thought.controller

		let reflection: Reflection | null = null
		try {
			reflection = await reflect.reflect(
				{ board: boardSummary, persona, recentComments: recentComments() },
				thought.controller.signal
			)
		} catch {
			// Cancelled or failed — nothing to say or add.
		}

		if (disposed || !queue.includes(thought)) return
		if (inFlight === thought.controller) inFlight = null

		if (!reflection || !reflection.comment) {
			// The ghosts are still worth having even with nothing said about them.
			if (reflection) stageReflection(reflection)()
			abandon(thought)
			return
		}

		ready(thought, reflection.comment, reflection.focus ?? [], stageReflection(reflection))
	}

	/** The canvas half of a reflection — the ghosts it proposes, put up as the reading begins. */
	const stageReflection = (reflection: Reflection) => () => {
		if (reflection.ideas.length > 0) ideaSuggestions.set(planIdeas!(reflection.ideas))
		const proposedRelations = reflection.relations ?? []
		if (proposedRelations.length > 0) {
			relationSuggestions.set(
				proposedRelations.map((relation, index): GhostRelation => ({
					id: `rel-${index}`,
					from: relation.from,
					to: relation.to,
					...(relation.label ? { label: relation.label } : {}),
				}))
			)
		}
	}

	/**
	 * Read the board after a change the companion or user just made, and say what the board is
	 * now — its new state and how the change shifts the overall picture. This is what the
	 * companion says after committing its own edits, in place of a canned line: a fresh comment,
	 * not a receipt. Direct, because it answers a decision the user just took; the self-edit
	 * episode that follows is swallowed (see `agentEditUntil`) so this is the only remark.
	 */
	const commentOnChange = async (recentChange: string) => {
		if (!reflect || !board) return

		const boardSummary = board()
		const thought = enqueue(newThought({ priority: 'direct', gesture: recentChange }))
		inFlight?.abort()
		inFlight = thought.controller

		let reflection: Reflection | null = null
		try {
			reflection = await reflect.reflect(
				{ board: boardSummary, recentChange, recentComments: recentComments() },
				thought.controller.signal
			)
		} catch {
			// Cancelled or failed — nothing to say.
		}

		if (disposed || !queue.includes(thought)) return
		if (inFlight === thought.controller) inFlight = null

		if (!reflection || !reflection.comment) {
			abandon(thought)
			return
		}

		ready(thought, reflection.comment, reflection.focus ?? [])
	}

	/**
	 * An episode has closed. Decide whether it becomes a thought, and if not, whether its events
	 * ride along with the next one.
	 *
	 * Every gate that declines has to answer the second question too, which is why they are not
	 * bare returns. The cap is the one that matters most: it sits *above* the model call, not
	 * above the chip, because a cap enforced after the request is a display cap and an
	 * uncapped bill.
	 */
	const handleEpisode = (summary: EpisodeSummary, events: SpatialEvent[]) => {
		/** The arc stays open: these events ride along with the next episode. */
		const keep = () => {
			carried = events.slice(-EPISODE_BUFFER_LIMIT)
		}

		if (!observationEnabled.get() || isTrivialEpisode(summary)) {
			// Nothing is sent, so nothing is spent. A lone trivial episode is noise and is
			// dropped as it always was — but once an arc is open, `events` is that whole arc,
			// and returning without keeping it would truncate the arc to whatever came before
			// this episode.
			if (carried.length > 0) keep()
			return
		}
		// The companion's own edit — an accepted grouping or committed ideas — finalizes as an
		// episode moments later. Skip it: narrating or re-acting on its own work would loop.
		// `carried` is left exactly as it was; our edit is not part of the user's arc.
		if (now() < agentEditUntil) return
		// A proposal is on the canvas awaiting a decision — never talk over a pending ghost.
		if (proposalPending()) {
			keep()
			return
		}
		// Full. The gesture is not lost: it waits for a slot and is folded into the thought that
		// takes it, so a burst costs at most this many observe calls and no observations.
		if (queue.length >= QUEUE_LIMIT) {
			keep()
			return
		}

		carried = []
		const episodeContext = context?.(summary) ?? EMPTY_CONTEXT
		const thought = enqueue(
			newThought({
				priority: 'ambient',
				gesture: describeGesture(summary, episodeContext),
				summary,
				events,
				focus: episodeNodes(summary),
			})
		)
		void think(thought)
	}

	/**
	 * Ask for a grouping now, organised by the user's intent. Bypasses the proactive gates —
	 * the user asked, and told the companion what they are grouping by.
	 */
	const requestGrouping = (intent: string) => {
		if (disposed) return
		// A proposal is already on the canvas; deciding it comes first.
		if (proposalPending()) return
		// Respect the master switch: an asleep companion doesn't reach into the canvas.
		if (!observationEnabled.get()) return
		void runSuggestion('demand', board?.(), intent)
	}

	/** Commit the pending grouping, comment on the board's new state, and swallow the self-edit episode. */
	const acceptGrouping = () => {
		if (disposed) return
		const suggestion = groupingSuggestion.get()
		if (!suggestion) return

		// Clear the ghost before the move, so the follow-up episode sees no pending proposal
		// and is caught by the self-edit window below instead.
		groupingSuggestion.set(null)
		const moved = applyGrouping?.({ members: suggestion.members, targets: suggestion.targets }) ?? 0
		// Whatever moved, our edit finalizes as an episode about `idleMs` from now; skip it, so
		// the comment below is the only remark about the change. Measured against the pause the
		// recorder is actually waiting, which the backoff may have stretched well past the base.
		agentEditUntil = now() + armedIdleMs + AGENT_EDIT_GRACE_MS
		if (moved <= 0) return

		const change = suggestion.rationale
			? `pulled ${moved} ideas together into a cluster — ${suggestion.rationale}`
			: `pulled ${moved} ideas together into a cluster`
		void commentOnChange(change)
	}

	/** Reflect on the whole board now, through the chosen persona. Bypasses the proactive gates. */
	const requestReflection = (persona: string) => {
		if (disposed) return
		if (!observationEnabled.get()) return
		// A decision is already pending on the canvas; settle it first.
		if (proposalPending()) return
		void runReflection(board?.(), persona)
	}

	/** Commit the named ghost ideas as agent-stamped notes, and swallow the self-edit episode. */
	const commitIdeas = (ideaIds: string[]) => {
		if (disposed) return
		const pending = ideaSuggestions.get()
		const chosen = pending.filter((idea) => ideaIds.includes(idea.id))
		if (chosen.length === 0) return

		const createdIds =
			createAgentNotes?.(chosen.map((idea) => ({ text: idea.text, x: idea.x, y: idea.y }))) ?? []
		// A new note that asked to connect gets its arrow too — from the fresh note to the
		// existing one it named — so accepting the idea draws the link in the same step.
		const arrows = chosen
			.map((idea, index) =>
				idea.connectTo && createdIds[index]
					? {
							from: createdIds[index],
							to: idea.connectTo,
							...(idea.connectLabel ? { label: idea.connectLabel } : {}),
						}
					: null
			)
			.filter((arrow): arrow is { from: NodeId; to: NodeId; label?: string } => arrow !== null)
		if (arrows.length > 0) createAgentRelations?.(arrows)

		// Drop the committed ideas from the pending set regardless of the write's result, so a
		// failed write can't strand a ghost that no longer maps to anything.
		ideaSuggestions.set(pending.filter((idea) => !ideaIds.includes(idea.id)))
		if (createdIds.length > 0) {
			// Our own notes finalize as an episode; skip it so the comment below is the only remark.
			agentEditUntil = now() + armedIdleMs + AGENT_EDIT_GRACE_MS
			const count = createdIds.length
			void commentOnChange(`added ${count} new ${count === 1 ? 'idea' : 'ideas'} to the board`)
		}
	}

	/** Commit the named ghost relations as agent-drawn arrows, and swallow the self-edit episode. */
	const commitRelations = (relationIds: string[]) => {
		if (disposed) return
		const pending = relationSuggestions.get()
		const chosen = pending.filter((relation) => relationIds.includes(relation.id))
		if (chosen.length === 0) return

		const drawn =
			createAgentRelations?.(
				chosen.map((relation) => ({
					from: relation.from,
					to: relation.to,
					...(relation.label ? { label: relation.label } : {}),
				}))
			) ?? 0
		relationSuggestions.set(pending.filter((relation) => !relationIds.includes(relation.id)))
		if (drawn > 0) {
			agentEditUntil = now() + armedIdleMs + AGENT_EDIT_GRACE_MS
			void commentOnChange(
				`drew ${drawn} new ${drawn === 1 ? 'connection' : 'connections'} between ideas`
			)
		}
	}

	/**
	 * The × on a chip.
	 *
	 * The user's own decision, so it costs the pacing policy nothing: a cancelled thought is not
	 * evidence that the pause was misjudged, it is evidence that the user did not want this
	 * particular remark. It is also the only route by which a clip already speaking is ever cut
	 * off — the queue never does that on its own.
	 */
	const cancelThought = (id: number) => {
		if (disposed) return
		const thought = queue.find((held) => held.id === id)
		if (!thought) return

		thought.controller.abort()
		remove(thought)
		// A clip already playing has to be silenced; aborting only cancels a request. The
		// client reports the ending, which is what lets the pump move on.
		if (thought.state === 'speaking') voice.stop()
		publishQueue()
		void pump()
	}

	// Subscribed before the recorder, deliberately. Both listen to the same stream and are
	// called in subscription order, and the recorder arms its timer from `nextIdleMs()` — so
	// a penalty for this event has to be in place before it does, or a raised pause would
	// not govern the very gesture that raised it.
	const unsubscribeActivity = stream.subscribe(handleActivity)

	const disposeRecorder = createEpisodeRecorder(stream, {
		onEpisode: (summary, events) => {
			// A carried arc rides along, re-folded with the new events as a single episode: what
			// the observer receives is what it would have seen had the user never paused.
			// Bounded like the recorder's own buffer, and with the same tradeoff — the slice
			// costs the oldest `before`, so it is set far above any real gesture.
			if (carried.length === 0) {
				handleEpisode(summary, events)
				return
			}
			const merged = [...carried, ...events].slice(-EPISODE_BUFFER_LIMIT)
			handleEpisode(buildEpisodeSummary(merged), merged)
		},
		schedule,
		idleMs: nextIdleMs,
	})

	/**
	 * A proposal has been decided, so the remarks waiting behind it may go.
	 *
	 * The ghosts are cleared from four places — two here, two in the controls the user clicks —
	 * and chasing every setter would leave the queue wedged the first time a fifth appeared.
	 * Reading the atoms is what makes this re-run; the microtask keeps the pump's own writes
	 * out of the reaction that scheduled it.
	 */
	let proposalWasPending = proposalPending()
	const unwatchProposals = react('companion proposal decided', () => {
		const pending = proposalPending()
		// Only the *transition* to nothing-pending, never the standing state. A reaction that
		// pumped whenever no ghost was up would fire once at construction, and the microtask
		// carrying it would land after whatever the caller did next — reaching a queue it was
		// never meant to see.
		const cleared = proposalWasPending && !pending
		proposalWasPending = pending
		if (cleared) queueMicrotask(() => void pump())
	})

	const dispose = () => {
		disposed = true
		unsubscribeActivity()
		disposeRecorder()
		unwatchProposals()
		cancelWake?.()
		cancelWake = null
		for (const thought of queue) thought.controller.abort()
		inFlight?.abort()
		inFlight = null
		queue = []
		carried = []
		// Abort only cancels a request; a clip already speaking has to be silenced, or the
		// companion keeps talking after the canvas it was describing is gone. It also settles
		// whatever the pump is still awaiting, so the loop does not hold the editor alive.
		voice.stop()
		companionQueue.set([])
		companionStage.set('idle')
		companionUtterance.set(null)
		companionFocus.set([])
		// The rhythm belonged to this mount's user and this mount's canvas. A StrictMode
		// remount starts from the resting pause, like a fresh session.
		companionPacing.set({ idleMs: idleMs ?? EPISODE_IDLE_MS, dropped: 0 })
		// Pending proposals belong to the canvas that is going away.
		groupingSuggestion.set(null)
		ideaSuggestions.set([])
		relationSuggestions.set([])
	}

	return {
		dispose,
		requestGrouping,
		acceptGrouping,
		requestReflection,
		commitIdeas,
		commitRelations,
		cancelThought,
	}
}
