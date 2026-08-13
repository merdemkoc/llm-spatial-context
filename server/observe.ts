/**
 * The observe endpoint's brain: one episode in, a speak/stay-silent decision out.
 *
 * Runs server-side so the Anthropic key never reaches the browser. Uses structured
 * output — the model must return `{ speak, comment }` — so silence is a first-class,
 * parseable answer rather than something to detect in prose. Low effort keeps the
 * "thinking…" pause short; the output is one or two sentences, so `max_tokens` is small.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
	DECISION_SCHEMA,
	OBSERVER_MODEL,
	renderEpisode,
	SYSTEM_PROMPT,
	type EpisodePayload,
} from './prompt.ts'

export interface ObserverDecision {
	speak: boolean
	comment: string
}

// Constructed lazily: the SDK throws at construction when no key is set, and we want the
// server to boot and serve the app regardless — a missing key should degrade the observer
// to graceful silence (handled by the route), not stop the whole process from starting.
let anthropic: Anthropic | null = null
function client(): Anthropic {
	return (anthropic ??= new Anthropic())
}

export async function observe(payload: EpisodePayload): Promise<ObserverDecision> {
	const response = await client().messages.create({
		model: OBSERVER_MODEL,
		max_tokens: 512,
		system: SYSTEM_PROMPT,
		output_config: {
			effort: 'low',
			format: { type: 'json_schema', name: 'observer_decision', schema: DECISION_SCHEMA },
		},
		messages: [{ role: 'user', content: renderEpisode(payload) }],
	})

	const block = response.content.find((entry) => entry.type === 'text')
	if (!block || block.type !== 'text') {
		return { speak: false, comment: '' }
	}

	const parsed = JSON.parse(block.text) as { speak?: boolean; comment?: string }
	return { speak: Boolean(parsed.speak), comment: parsed.comment ?? '' }
}
