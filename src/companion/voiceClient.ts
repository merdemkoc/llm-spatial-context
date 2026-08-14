/**
 * The client half of the voice call.
 *
 * A `VoiceClient` turns a comment into sound. The interface is the seam the orchestrator
 * depends on, so a test substitutes a silent fake; `createHttpVoiceClient` is the real one:
 * POST the text to the server (which calls the TTS model with its own key), then play the
 * returned audio.
 *
 * One voice at a time. `speak()` resolves when playback *starts*, not when it ends, so two
 * episodes a few seconds apart would otherwise leave two clips talking over each other —
 * the companion interrupting itself. A new comment stops whatever is still speaking.
 *
 * It also reports *when* it is speaking and *how far through*. Synthesis takes a second or
 * three, and without those callbacks the caller can only guess: the text would land as soon
 * as the model decided, then the sound would arrive later, and a remark the user has already
 * finished reading would start being read to them. Progress is sampled from the audio
 * element itself, so it survives a slow start or a mid-sentence stop.
 */
export interface SpeakOptions {
	signal?: AbortSignal
	/** Playback has begun — this is the moment the words may appear on screen. */
	onStart?: () => void
	/** How far through the clip playback is, 0–1. Called per animation frame, and once at 1. */
	onProgress?: (fraction: number) => void
}

export interface VoiceClient {
	/** Speak `text`, replacing anything still playing. Resolves once playback has started. */
	speak(text: string, options?: SpeakOptions): Promise<void>
	/** Stop any playback and release its audio. */
	stop(): void
}

/** The real client: POST the text to the server proxy and play the returned audio. */
export function createHttpVoiceClient(endpoint = '/api/speak'): VoiceClient {
	let current: { audio: HTMLAudioElement; url: string; frame: number | null } | null = null

	const release = () => {
		if (!current) return
		const { audio, url, frame } = current
		current = null
		if (frame !== null) cancelAnimationFrame(frame)
		audio.pause()
		URL.revokeObjectURL(url)
	}

	return {
		stop: release,

		async speak(text, options) {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
				signal: options?.signal,
			})
			if (!response.ok) {
				throw new Error(`speak failed: ${response.status}`)
			}

			const blob = await response.blob()
			if (options?.signal?.aborted) return

			// Whatever was speaking is now stale: this comment supersedes it.
			release()

			const url = URL.createObjectURL(blob)
			const audio = new Audio(url)
			const playing = { audio, url, frame: null as number | null }
			current = playing

			const revoke = () => {
				if (current?.audio === audio) current = null
				if (playing.frame !== null) cancelAnimationFrame(playing.frame)
				URL.revokeObjectURL(url)
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
		},
	}
}
