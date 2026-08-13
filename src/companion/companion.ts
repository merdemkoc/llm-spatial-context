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
 * The clients and the timer are injected; nothing here reaches the network directly.
 */
import {
	createEpisodeRecorder,
	isTrivialEpisode,
	type EpisodeSummary,
	type Schedule,
	type SpatialEventStream,
} from '@/domain'
import type { ObserverClient } from '@/companion/observerClient'
import type { VoiceClient } from '@/companion/voiceClient'
import {
	companionThinking,
	companionTranscript,
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
}: CompanionOptions): () => void {
	let inFlight: AbortController | null = null
	// Bumped per episode. A response whose generation is stale (its episode was
	// superseded) is ignored even if the observer ignored the abort signal.
	let generation = 0

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
		companionThinking.set(true)

		let decision = null as Awaited<ReturnType<ObserverClient['observe']>> | null
		try {
			decision = await observer.observe(
				{ episode: summary, recentComments: recentComments() },
				controller.signal
			)
		} catch {
			// Aborted by a newer episode, or the request failed — either way there is
			// nothing to say. The generation check below decides who owns the UI.
		}

		// A newer episode started while we waited: it now owns the thinking indicator
		// and the answer we have is about a canvas that has already changed. Drop it.
		if (mine !== generation) return

		inFlight = null
		companionThinking.set(false)

		if (!decision || !decision.speak || !decision.comment) return

		// Record before speaking so the transcript fills even with voice off, and so a
		// playback failure can't lose the observation.
		record(decision.comment)
		if (voiceEnabled.get()) {
			try {
				await voice.speak(decision.comment)
			} catch {
				// A blocked or failed playback shouldn't take down the loop.
			}
		}
	}

	const disposeRecorder = createEpisodeRecorder(stream, {
		onEpisode: (summary) => void handleEpisode(summary),
		schedule,
		idleMs,
	})

	return () => {
		disposeRecorder()
		inFlight?.abort()
		inFlight = null
	}
}
