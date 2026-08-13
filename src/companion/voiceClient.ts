/**
 * The client half of the voice call.
 *
 * A `VoiceClient` turns a comment into sound. The interface is the seam the orchestrator
 * depends on, so a test substitutes a silent fake; `createHttpVoiceClient` is the real one:
 * POST the text to the server (which calls the TTS model with its own key), then play the
 * returned audio. The object URL is revoked once playback finishes so a long session does
 * not leak blobs.
 */
export interface VoiceClient {
	/** Play `text` aloud. Resolves once playback has started. */
	speak(text: string): Promise<void>
}

/** The real client: POST the text to the server proxy and play the returned audio. */
export function createHttpVoiceClient(endpoint = '/api/speak'): VoiceClient {
	return {
		async speak(text) {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
			})
			if (!response.ok) {
				throw new Error(`speak failed: ${response.status}`)
			}

			const url = URL.createObjectURL(await response.blob())
			const audio = new Audio(url)
			const revoke = () => URL.revokeObjectURL(url)
			audio.addEventListener('ended', revoke, { once: true })
			audio.addEventListener('error', revoke, { once: true })
			await audio.play()
		},
	}
}
