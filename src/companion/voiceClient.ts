/**
 * The client half of the voice call.
 *
 * A `VoiceClient` turns a comment into sound. The interface is the seam the orchestrator
 * depends on, so a test substitutes a silent fake; `createHttpVoiceClient` is the real one:
 * POST the text to the server (which calls the TTS model with its own key), then play the
 * returned audio.
 *
 * One voice at a time. `play()` resolves when playback *starts*, not when it ends, so two
 * episodes a few seconds apart would otherwise leave two clips talking over each other —
 * the companion interrupting itself. A new comment stops whatever is still speaking.
 */
export interface VoiceClient {
	/** Speak `text`, replacing anything still playing. Resolves once playback has started. */
	speak(text: string, signal?: AbortSignal): Promise<void>
	/** Stop any playback and release its audio. */
	stop(): void
}

/** The real client: POST the text to the server proxy and play the returned audio. */
export function createHttpVoiceClient(endpoint = '/api/speak'): VoiceClient {
	let current: { audio: HTMLAudioElement; url: string } | null = null

	const release = () => {
		if (!current) return
		const { audio, url } = current
		current = null
		audio.pause()
		URL.revokeObjectURL(url)
	}

	return {
		stop: release,

		async speak(text, signal) {
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
			if (signal?.aborted) return

			// Whatever was speaking is now stale: this comment supersedes it.
			release()

			const url = URL.createObjectURL(blob)
			const audio = new Audio(url)
			current = { audio, url }

			const revoke = () => {
				if (current?.audio === audio) current = null
				URL.revokeObjectURL(url)
			}
			audio.addEventListener('ended', revoke, { once: true })
			audio.addEventListener('error', revoke, { once: true })

			try {
				await audio.play()
			} catch (error) {
				// A rejected `play()` (autoplay blocked, for instance) fires neither `ended`
				// nor `error`, so without this the blob would be retained for the page's life.
				revoke()
				throw error
			}
		},
	}
}
