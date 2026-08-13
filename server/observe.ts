/**
 * The observe endpoint's brain: one episode in, a speak/stay-silent decision out.
 *
 * Runs server-side so the Anthropic key never reaches the browser. Uses structured
 * output — the model must return `{ speak, comment }` — so silence is a first-class,
 * parseable answer rather than something to detect in prose.
 *
 * Thinking is off and `max_tokens` is generous rather than tight. `max_tokens` caps
 * thinking *plus* text, and Sonnet 5 thinks by default, so the original 512 could be
 * spent reasoning and return truncated JSON — which parses to nothing and is
 * indistinguishable from a considered silence. For a one-or-two-sentence judgement the
 * latency of thinking is not worth that risk: the companion's whole feel depends on the
 * pause being short.
 */
import Anthropic from '@anthropic-ai/sdk'
import { DECISION_SCHEMA, observerModel, renderEpisode, SYSTEM_PROMPT } from './prompt.ts'
import type { EpisodePayload } from './prompt.ts'

export interface ObserverDecision {
	speak: boolean
	comment: string
}

/** Stay quiet. The one safe answer whenever a response can't be trusted. */
const SILENCE: ObserverDecision = { speak: false, comment: '' }

// Constructed lazily: the SDK throws at construction when no key is set, and we want the
// server to boot and serve the app regardless — a missing key should degrade the observer
// to graceful silence (handled by the route), not stop the whole process from starting.
let anthropic: Anthropic | null = null
function client(): Anthropic {
	return (anthropic ??= new Anthropic())
}

export async function observe(payload: EpisodePayload): Promise<ObserverDecision> {
	const response = await client().messages.create({
		model: observerModel(),
		max_tokens: 1024,
		system: SYSTEM_PROMPT,
		// Off rather than adaptive: see the note above on truncation and latency.
		thinking: { type: 'disabled' },
		output_config: {
			// `format` takes `type` and `schema` only. An extra `name` here (an OpenAI-ism)
			// is rejected with a 400, which the route turns into silence — so the companion
			// looks thoughtful while being entirely broken. Keep this shape exact.
			format: { type: 'json_schema', schema: DECISION_SCHEMA },
		},
		messages: [{ role: 'user', content: renderEpisode(payload) }],
	})

	// A refusal or a truncated response is not a decision. Say so in the log rather than
	// letting it read as the model choosing to stay quiet.
	if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
		console.warn(`[observe] no usable decision: stop_reason=${response.stop_reason}`)
		return SILENCE
	}

	const block = response.content.find((entry) => entry.type === 'text')
	if (!block || block.type !== 'text') return SILENCE

	try {
		const parsed = JSON.parse(block.text) as { speak?: boolean; comment?: string }
		const comment = typeof parsed.comment === 'string' ? parsed.comment.trim() : ''
		// A `speak: true` with nothing to say is silence; so is a comment nobody asked for.
		return parsed.speak === true && comment !== '' ? { speak: true, comment } : SILENCE
	} catch {
		console.warn('[observe] structured output did not parse')
		return SILENCE
	}
}
