/**
 * The speak endpoint's brain: text in, spoken audio out.
 *
 * Runs server-side so the OpenAI key stays off the client. Returns mp3 bytes the browser
 * plays. The voice is read from the environment inside the call, not captured in a module
 * constant — ESM evaluates this module before `index.ts` loads `.env`, so a constant would
 * bake the default and ignore the setting.
 */
import OpenAI from 'openai'

/** Longest comment we will synthesize. A companion speaks in sentences, not essays. */
export const MAX_SPEAK_CHARS = 600

// Constructed lazily (see observe.ts) so a missing key fails the route, not server boot.
let openai: OpenAI | null = null
function client(): OpenAI {
	return (openai ??= new OpenAI())
}

export async function synthesize(text: string): Promise<Buffer> {
	const response = await client().audio.speech.create({
		model: 'gpt-4o-mini-tts',
		voice: process.env.TTS_VOICE ?? 'alloy',
		input: text.slice(0, MAX_SPEAK_CHARS),
		response_format: 'mp3',
	})
	return Buffer.from(await response.arrayBuffer())
}
