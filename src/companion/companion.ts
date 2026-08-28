/**
 * The companion orchestrator — the MVP-2 loop, wired.
 *
 *   observe → detect meaningful change → think → comment → speak
 *
 * It owns an `EpisodeRecorder` over the spatial event stream and, for each finalized
 * episode, runs the second stage of the significance model: the local gate
 * (`isTrivialEpisode`) has already dropped the noise, so anything that reaches here is
 * worth *asking* about — but the model still decides whether it is worth *speaking*
 * about. A silent verdict is a first-class outcome, not a failure.
 *
 * Three behaviours the spec asks for, made explicit here:
 *   - **Two switches.** `observationEnabled` gates the model call; `voiceEnabled` gates
 *     only playback. Off/off is silent, on/off fills the transcript without speaking.
 *   - **Interruption.** At most one observation is in flight. A new episode aborts the
 *     previous request — the canvas moved on, so its answer is stale — and a generation
 *     counter makes a late/ignored-abort response harmless.
 *   - **Anti-repetition.** The last few spoken comments ride along with each request so
 *     the model can vary its phrasing instead of narrating the same trend every pause.
 *
 * **The pause is a guess, and it learns.** An episode closes after a fixed quiet, and
 * behind it sits ~4.7s of model call and synthesis during which the canvas is free to
 * change. So a pause mid-arrangement, read as the end of a gesture, produces an answer
 * about a canvas that no longer exists. Three things follow, and together they are most of
 * what this file does beyond the loop above:
 *   - **A thought dies when the user returns**, not when the next episode closes. Waiting
 *     for the next close meant a whole further pause in which a stale remark was free to
 *     arrive and be spoken over the gesture in progress.
 *   - **The killed gesture is carried forward.** Its events are re-folded into the next
 *     episode, so what the observer eventually receives is what it would have seen had the
 *     user never paused — the whole arc, not the part after the false ending.
 *   - **The pause moves.** A kill tells us exactly how much quiet was not enough, and
 *     `createIdleBackoff` turns that into the next pause. A remark that lands hands half of
 *     it back. Waiting longer therefore costs nothing in coverage, which is what makes the
 *     escalation safe.
 *
 * A clip already speaking is the one thing renewed interaction does *not* stop: the remark
 * has been decided and is half-heard, and cutting a sentence off mid-word every time the
 * board is touched is worse than one that finishes a moment late. Because `speak` resolves
 * at playback start, aborting a thought lands on synthesis and can never reach sound. A
 * *newer remark* does stop the old clip — otherwise it talks on with nothing on screen.
 *
 * **Text arrives with the voice.** Deciding what to say and synthesizing it are two waits,
 * a second or three each. Announcing the remark after the first one meant the user read it,
 * finished, and only then heard it read aloud — so the thinking hint stays up through
 * synthesis and the words are released as playback reports them (`companionUtterance`). The
 * transcript is still written before playback, because it is the record of what the
 * companion decided rather than a view of what it is currently saying: with voice off, or
 * when synthesis fails, the observation must survive either way.
 *
 * The clients and the timer are injected; nothing here reaches the network directly.
 */
import {
	buildEpisodeSummary,
	createEpisodeRecorder,
	createIdleBackoff,
	EPISODE_BUFFER_LIMIT,
	EPISODE_IDLE_MS,
	isTrivialEpisode,
	type EpisodeSummary,
	type Schedule,
	type SpatialEvent,
	type SpatialEventStream,
} from '@/domain'
import type { EpisodeContext, ObserverClient } from '@/companion/observerClient'
import type { VoiceClient } from '@/companion/voiceClient'
import {
	companionPacing,
	companionStage,
	companionTranscript,
	companionUtterance,
	observationEnabled,
	voiceEnabled,
} from '@/companion/companionState'

/** How many recent comments to hand the model for anti-repetition. */
export const DEFAULT_HISTORY_SIZE = 3

/** Cap on retained transcript entries, so a long session doesn't grow unbounded. */
export const TRANSCRIPT_LIMIT = 50

export interface CompanionOptions {
	stream: SpatialEventStream
	observer: ObserverClient
	voice: VoiceClient
	/** Timer for episode finalization; forwarded to the recorder. */
	schedule?: Schedule
	/**
	 * The pause an episode *rests* at before finalizing. Defaults to `EPISODE_IDLE_MS`.
	 *
	 * Not the pause actually waited out: that is `createIdleBackoff`'s, which starts here,
	 * rises when a gesture turns out to have been misread as finished, and returns here.
	 */
	idleMs?: number
	/** Clock for transcript timestamps. Injected so tests are deterministic. */
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
}

const EMPTY_CONTEXT: EpisodeContext = { labels: {}, relations: [] }

/**
 * The thought in flight: what it was about, when it started, and how to call it off.
 *
 * It lives from the moment an episode closes until the remark reaches the user (or turns
 * out to be silence). For that whole span it is *killable*, and everything needed to kill
 * it well is here — the signal to abort, the events to carry forward, and the two numbers
 * that say how much quiet preceded it.
 */
interface PendingThought {
	generation: number
	controller: AbortController
	/** The clock at episode close — the origin for measuring the quiet that fooled us. */
	closedAt: number
	/** The pause the recorder had actually waited out to close that episode. */
	idleAtClose: number
	/** The events behind it, kept so killing it does not lose the gesture's starting point. */
	events: SpatialEvent[]
}

/**
 * Start the companion over a stream. Returns a disposer that stops the recorder and
 * aborts any in-flight observation — collect it with the other `handleMount` disposers.
 */
export function createCompanion({
	stream,
	observer,
	voice,
	schedule,
	idleMs,
	now = Date.now,
	historySize = DEFAULT_HISTORY_SIZE,
	context,
}: CompanionOptions): () => void {
	let pending: PendingThought | null = null
	// Bumped per episode, and again whenever a thought is killed. A response whose
	// generation is stale is ignored even if the observer ignored the abort signal.
	let generation = 0
	let disposed = false

	/** A killed thought's events, waiting to be folded into the next episode. */
	let carried: SpatialEvent[] = []
	/** Thoughts the user came back too soon for. Reported, not acted on. */
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

	/**
	 * This thought is over and nothing interrupted it — it reached the user, it had nothing
	 * to say, or it failed on its own. Either way the quiet it waited out was long enough,
	 * so the policy hands back half of whatever penalty it is carrying, and the events are
	 * spent: they have been shown to the observer.
	 */
	const settle = () => {
		pending = null
		carried = []
		backoff.settled()
		publishPacing()
		companionStage.set('idle')
	}

	/**
	 * The user is back.
	 *
	 * Whatever is in flight is now an answer about a canvas that has changed, so it is
	 * called off rather than left to arrive and be spoken over the gesture in progress. A
	 * clip already playing has no `pending` behind it and is deliberately left alone.
	 */
	const handleActivity = () => {
		const killed = pending
		if (!killed) return

		generation += 1
		pending = null
		killed.controller.abort()

		// The quiet that fooled us, measured rather than guessed: what the recorder waited
		// out, plus how long the user stayed away after it fired. A pause past that would
		// not have closed the episode where this one closed.
		backoff.interrupted(killed.idleAtClose + (now() - killed.closedAt))
		dropped += 1
		// Not lost: this holds the gesture's `before`.
		carried = killed.events

		publishPacing()
		companionStage.set('idle')
	}

	const recentComments = () =>
		companionTranscript
			.get()
			.slice(-historySize)
			.map((entry) => entry.comment)

	const record = (comment: string) => {
		const next = [...companionTranscript.get(), { comment, at: now() }]
		companionTranscript.set(next.slice(-TRANSCRIPT_LIMIT))
	}

	const handleEpisode = async (summary: EpisodeSummary, events: SpatialEvent[]) => {
		if (!observationEnabled.get() || isTrivialEpisode(summary)) {
			// Nothing is sent, so nothing is spent. A lone trivial episode is noise and is
			// dropped as it always was — but once an arc is open, `events` is that whole arc,
			// and returning without keeping it would truncate the arc to whatever came before
			// this episode. Growth is bounded by the same `EPISODE_BUFFER_LIMIT` slice the
			// merge applies.
			if (carried.length > 0) carried = events
			return
		}

		generation += 1
		const mine = generation
		// Still in flight here means the canvas fell quiet again on its own rather than the
		// user coming back, so this thought is superseded, not killed: nothing to learn.
		pending?.controller.abort()
		const controller = new AbortController()
		pending = {
			generation: mine,
			controller,
			closedAt: now(),
			idleAtClose: armedIdleMs,
			events,
		}
		companionStage.set('observing')
		// The previous remark's performance is over the moment a newer thought starts: its
		// half-revealed sentence must not resurface behind this one, least of all if this one
		// turns out to be silence. The transcript still has it whole.
		//
		// The sound goes with the text, and in that order — the utterance is what says a clip
		// is playing at all. Clearing one without the other leaves the old remark talking
		// over the new thought with nothing on screen behind it.
		if (companionUtterance.get() !== null) voice.stop()
		companionUtterance.set(null)

		let decision = null as Awaited<ReturnType<ObserverClient['observe']>> | null
		try {
			decision = await observer.observe(
				{
					episode: summary,
					context: context?.(summary) ?? EMPTY_CONTEXT,
					recentComments: recentComments(),
				},
				controller.signal
			)
		} catch {
			// Aborted by a newer episode, or the request failed — either way there is
			// nothing to say. The generation check below decides who owns the UI.
		}

		// A newer episode started while we waited: it now owns the thinking indicator
		// and the answer we have is about a canvas that has already changed. Drop it.
		if (mine !== generation) return
		// Torn down while we waited: the atoms belong to whatever mounts next.
		if (disposed) return

		const silent = !decision || !decision.speak || !decision.comment
		// Re-read the switch rather than trusting the check made before the await: a user
		// who switches observation off mid-thought is asking not to be spoken to, and the
		// answer in hand was authorised by a setting that no longer holds.
		if (silent || !observationEnabled.get()) {
			settle()
			return
		}

		const comment = decision!.comment!

		// Record before speaking so the transcript fills even with voice off, and so a
		// playback failure can't lose the observation.
		record(comment)

		if (!voiceEnabled.get()) {
			// Nothing to wait for, so the remark is the whole remark, immediately.
			settle()
			return
		}

		/** Ours only until a newer episode takes over, or the companion is torn down. */
		const owns = () => mine === generation && !disposed

		// The second half of the wait, and a different job: the sentence exists, and now a
		// voice for it is being rendered. Saying so is the difference between a hint that
		// looks stuck and one that reports progress.
		companionStage.set('composing')

		try {
			await voice.speak(comment, {
				// What carries a kill through to the TTS request. It can only ever reach
				// synthesis: `speak` resolves at playback start, so by the time there is sound
				// there is no `pending` left to abort.
				signal: controller.signal,
				onStart: () => {
					if (!owns()) return
					// The hint comes down exactly as the voice comes up: one hands over to
					// the other, so there is never a silent sentence sitting on screen. This is
					// also the moment the remark has reached the user, so the pause that
					// produced it is vindicated and the sentence stops being killable.
					settle()
					companionUtterance.set({ comment, fraction: 0 })
				},
				onProgress: (fraction) => {
					if (!owns()) return
					// Done speaking: drop the utterance so the bar falls back to the
					// transcript's newest entry, which is this same sentence in full.
					if (fraction >= 1) companionUtterance.set(null)
					else companionUtterance.set({ comment, fraction })
				},
			})
		} catch {
			// A blocked or failed playback shouldn't take down the loop — but it must not
			// leave the remark hidden behind a thinking hint that will never clear either.
			// `owns()` is false when the throw *was* the kill, which has cleaned up already.
			if (owns()) {
				settle()
				companionUtterance.set(null)
			}
		}
	}

	// Subscribed before the recorder, deliberately. Both listen to the same stream and are
	// called in subscription order, and the recorder arms its timer from `nextIdleMs()` — so
	// a penalty for this event has to be in place before it does, or a raised pause would
	// not govern the very gesture that raised it.
	const unsubscribeActivity = stream.subscribe(handleActivity)

	const disposeRecorder = createEpisodeRecorder(stream, {
		onEpisode: (summary, events) => {
			// A killed thought's events ride along, re-folded with the new ones as a single
			// episode: what the observer receives is what it would have seen had the user
			// never paused. Bounded like the recorder's own buffer, and with the same
			// tradeoff — the slice costs the oldest `before`, so it is set far above any real
			// gesture and is a backstop rather than a working limit.
			if (carried.length === 0) {
				void handleEpisode(summary, events)
				return
			}
			const merged = [...carried, ...events].slice(-EPISODE_BUFFER_LIMIT)
			void handleEpisode(buildEpisodeSummary(merged), merged)
		},
		schedule,
		idleMs: nextIdleMs,
	})

	return () => {
		disposed = true
		unsubscribeActivity()
		disposeRecorder()
		pending?.controller.abort()
		pending = null
		carried = []
		// Abort only cancels a request; a clip already speaking has to be silenced, or the
		// companion keeps talking after the canvas it was describing is gone.
		voice.stop()
		companionStage.set('idle')
		companionUtterance.set(null)
		// The rhythm belonged to this mount's user and this mount's canvas. A StrictMode
		// remount starts from the resting pause, like a fresh session.
		companionPacing.set({ idleMs: idleMs ?? EPISODE_IDLE_MS, dropped: 0 })
	}
}
