/**
 * The speak endpoint's brain: text in, spoken audio out.
 *
 * Runs server-side so the OpenAI key stays off the client. Returns mp3 bytes the browser
 * plays; the voice is an env var so a demo can pick one without a code change.
 */
import OpenAI from 'openai'

// Constructed lazily (see observe.ts) so a missing key fails the route, not server boot.
let openai: OpenAI | null = null
function client(): OpenAI {
	return (openai ??= new OpenAI())
}

const VOICE = process.env.TTS_VOICE ?? 'alloy'

export async function synthesize(text: string): Promise<Buffer> {
	const response = await client().audio.speech.create({
		model: 'gpt-4o-mini-tts',
		voice: VOICE,
		input: text,
		response_format: 'mp3',
	})
	return Buffer.from(await response.arrayBuffer())
}
