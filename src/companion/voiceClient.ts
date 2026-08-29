/**
 * The client half of the voice call.
 *
 * A `VoiceClient` turns a comment into sound. The interface is the seam the orchestrator
 * depends on, so a test substitutes a silent fake; `createHttpVoiceClient` is the real one:
 * POST the text to the server (which calls the TTS model with its own key), then play the
 * returned audio.
 *
 * One voice at a time. `speak()` resolves when playback *starts*, not when it ends, so two
 * remarks a few seconds apart would otherwise leave two clips talking over each other —
 * the companion interrupting itself. A new comment stops whatever is still speaking.
 *
 * It also reports *when* it is speaking, *how far through*, and *when it is over*. Synthesis
 * takes a second or three, and without the first two the caller can only guess: the text would
 * land as soon as the model decided, then the sound would arrive later, and a remark the user
 * has already finished reading would start being read to them. Progress is sampled from the
 * audio element itself, so it survives a slow start or a mid-sentence stop.
 *
 * **`onEnd` is the other edge, and it is total.** A caller that speaks remarks in turn waits
 * on it before starting the next one, so a clip that could end without saying so is a queue
 * that stops draining. Three of the five ways a clip can end produce no DOM event at all:
 * `stop()` ends it with `audio.pause()`, a refused `play()` fires neither `ended` nor `error`,
 * and a request called off after its bytes arrived never builds an element to fire anything.
 * So every exit from `speak()` runs it, exactly once — including the ones that also throw.
 */

/**
 * How long to wait for synthesis before giving up.
 *
 * The same guard, and the same number, as `OBSERVE_TIMEOUT_MS`. Without it a hung `/api/speak`
 * holds a caller waiting on this clip for as long as the socket stays open, which for a caller
 * speaking remarks in turn means never speaking again.
 */
export const SPEAK_TIMEOUT_MS = 20_000

export interface SpeakOptions {
	signal?: AbortSignal
	/** Playback has begun — this is the moment the words may appear on screen. */
	onStart?: () => void
	/** How far through the clip playback is, 0–1. Called per animation frame, and once at 1. */
	onProgress?: (fraction: number) => void
	/**
	 * This remark is over — played out, stopped, refused, replaced or never synthesised.
	 *
	 * Called exactly once per `speak()`, and always: it is the signal a caller paces itself
	 * by, so "usually" would be a deadlock waiting for the unlucky case. It says nothing
	 * about *how* the clip ended, because no caller has yet needed to know — a remark that
	 * was cut off and one that finished are both, from the outside, over.
	 */
	onEnd?: () => void
}

export interface VoiceClient {
	/** Speak `text`, replacing anything still playing. Resolves once playback has started. */
	speak(text: string, options?: SpeakOptions): Promise<void>
	/** Stop any playback and release its audio. */
	stop(): void
}

/** The real client: POST the text to the server proxy and play the returned audio. */
export function createHttpVoiceClient(
	endpoint = '/api/speak',
	timeoutMs = SPEAK_TIMEOUT_MS
): VoiceClient {
	// `end` rides along with the clip so `release()` — which is called from `stop()` and from
	// the next `speak()` — can report the ending it causes. It is the one thing here that the
	// element itself cannot tell us.
	let current: {
		audio: HTMLAudioElement
		url: string
		frame: number | null
		end: () => void
	} | null = null

	const release = () => {
		if (!current) return
		const { audio, url, frame, end } = current
		current = null
		if (frame !== null) cancelAnimationFrame(frame)
		audio.pause()
		URL.revokeObjectURL(url)
		// After the teardown, not before: `end` may start the next clip, and it must not find
		// this one still installed.
		end()
	}

	return {
		stop: release,

		async speak(text, options) {
			// Built before anything can fail, so every path out of here has an ending to report.
			let ended = false
			const end = () => {
				if (ended) return
				ended = true
				options?.onEnd?.()
			}

			try {
				// The caller's signal and our own deadline, combined the same way the observer
				// combines them: whichever fires first calls the request off.
				const timeout = AbortSignal.timeout(timeoutMs)
				const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout

				const response = await fetch(endpoint, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text }),
					signal,
				})
				if (!response.ok) {
					throw new Error(`speak failed: ${response.status}`)
				}

				const blob = await response.blob()
				if (options?.signal?.aborted) {
					// Called off between the bytes and the element. Nothing will ever play, and
					// nothing exists to say so, so this path says so itself.
					end()
					return
				}

				// Whatever was speaking is now stale: this comment supersedes it.
				release()

				const url = URL.createObjectURL(blob)
				const audio = new Audio(url)
				const playing = { audio, url, frame: null as number | null, end }
				current = playing

				const revoke = () => {
					if (current?.audio === audio) current = null
					if (playing.frame !== null) cancelAnimationFrame(playing.frame)
					URL.revokeObjectURL(url)
					end()
				}
				audio.addEventListener('error', revoke, { once: true })
				audio.addEventListener('ended', () => {
					// The last word has been said; make sure the caller ends on the whole
					// sentence rather than wherever the final frame happened to sample.
					options?.onProgress?.(1)
					revoke()
				})

				try {
					await audio.play()
				} catch (error) {
					// A rejected `play()` (autoplay blocked, for instance) fires neither `ended`
					// nor `error`, so without this the blob would be retained for the page's life.
					revoke()
					throw error
				}

				options?.onStart?.()

				// Per frame rather than on `timeupdate`, which fires about four times a second —
				// too coarse for words to land with the syllables they belong to.
				const sample = () => {
					if (current?.audio !== audio) return

					const { currentTime, duration } = audio
					if (Number.isFinite(duration) && duration > 0) {
						options?.onProgress?.(Math.min(1, currentTime / duration))
					}

					playing.frame = requestAnimationFrame(sample)
				}

				if (options?.onProgress) sample()
			} catch (error) {
				// A synthesis that never arrived is still a remark that is over. The caller sees
				// both the rejection and the ending; `end` is idempotent, so a failure that
				// already reported one costs nothing here.
				end()
				throw error
			}
		},
	}
}
