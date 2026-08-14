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
	createEpisodeRecorder,
	isTrivialEpisode,
	type EpisodeSummary,
	type Schedule,
	type SpatialEventStream,
} from '@/domain'
import type { EpisodeContext, ObserverClient } from '@/companion/observerClient'
import type { VoiceClient } from '@/companion/voiceClient'
import {
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
	/** Idle pause before an episode finalizes; forwarded to the recorder. */
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
	let inFlight: AbortController | null = null
	// Bumped per episode. A response whose generation is stale (its episode was
	// superseded) is ignored even if the observer ignored the abort signal.
	let generation = 0
	let disposed = false

	const recentComments = () =>
		companionTranscript
			.get()
			.slice(-historySize)
			.map((entry) => entry.comment)

	const record = (comment: string) => {
		const next = [...companionTranscript.get(), { comment, at: now() }]
		companionTranscript.set(next.slice(-TRANSCRIPT_LIMIT))
	}

	const handleEpisode = async (summary: EpisodeSummary) => {
		if (!observationEnabled.get()) return
		if (isTrivialEpisode(summary)) return

		generation += 1
		const mine = generation
		inFlight?.abort()
		const controller = new AbortController()
		inFlight = controller
		companionStage.set('observing')
		// The previous remark's performance is over the moment a newer thought starts: its
		// half-revealed sentence must not resurface behind this one, least of all if this one
		// turns out to be silence. The transcript still has it whole.
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

		inFlight = null

		const silent = !decision || !decision.speak || !decision.comment
		// Re-read the switch rather than trusting the check made before the await: a user
		// who switches observation off mid-thought is asking not to be spoken to, and the
		// answer in hand was authorised by a setting that no longer holds.
		if (silent || !observationEnabled.get()) {
			companionStage.set('idle')
			return
		}

		const comment = decision!.comment!

		// Record before speaking so the transcript fills even with voice off, and so a
		// playback failure can't lose the observation.
		record(comment)

		if (!voiceEnabled.get()) {
			// Nothing to wait for, so the remark is the whole remark, immediately.
			companionStage.set('idle')
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
				onStart: () => {
					if (!owns()) return
					// The hint comes down exactly as the voice comes up: one hands over to
					// the other, so there is never a silent sentence sitting on screen.
					companionStage.set('idle')
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
			if (owns()) {
				companionStage.set('idle')
				companionUtterance.set(null)
			}
		}
	}

	const disposeRecorder = createEpisodeRecorder(stream, {
		onEpisode: (summary) => void handleEpisode(summary),
		schedule,
		idleMs,
	})

	return () => {
		disposed = true
		disposeRecorder()
		inFlight?.abort()
		inFlight = null
		// Abort only cancels a request; a clip already speaking has to be silenced, or the
		// companion keeps talking after the canvas it was describing is gone.
		voice.stop()
		companionStage.set('idle')
		companionUtterance.set(null)
	}
}
