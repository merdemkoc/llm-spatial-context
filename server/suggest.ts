/**
 * The suggest endpoint's brain: the whole board in, a grouping proposal out.
 *
 * A sibling of `observe.ts` — same key handling, same structured-output posture, same
 * `format` shape (a `name` key here is a 400), same thinking-off, generous-`max_tokens`
 * reasoning — differing only in what it asks for. It never returns positions: the model
 * names members, the client arranges them. Any untrustworthy answer degrades to a decline.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
	GROUPING_SCHEMA,
	interpretGrouping,
	NO_GROUPING,
	renderSuggestRequest,
	suggesterModel,
	SUGGEST_SYSTEM_PROMPT,
	type GroupingSuggestion,
	type SuggestPayload,
} from './suggestPrompt.ts'

// Lazy, like `observe.ts`: a missing key degrades this to a decline (handled by the route)
// rather than stopping the server from booting.
let anthropic: Anthropic | null = null
function client(): Anthropic {
	return (anthropic ??= new Anthropic())
}

export async function suggest(payload: SuggestPayload): Promise<GroupingSuggestion> {
	const response = await client().messages.create({
		model: suggesterModel(),
		max_tokens: 1024,
		system: SUGGEST_SYSTEM_PROMPT,
		thinking: { type: 'disabled' },
		output_config: {
			// `format` takes `type` and `schema` only — an extra `name` is a 400. Keep exact.
			format: { type: 'json_schema', schema: GROUPING_SCHEMA },
		},
		messages: [{ role: 'user', content: renderSuggestRequest(payload) }],
	})

	if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
		console.warn(`[suggest] no usable decision: stop_reason=${response.stop_reason}`)
		return NO_GROUPING
	}

	const block = response.content.find((entry) => entry.type === 'text')
	if (!block || block.type !== 'text') return NO_GROUPING

	return interpretGrouping(block.text, payload.board)
}
