/**
 * The reflect endpoint's brain: the whole board in, a reading plus new ideas out.
 *
 * A sibling of `observe.ts` and `suggest.ts` — same key handling, same structured-output
 * posture, same `format` shape (a `name` key is a 400), same thinking-off, generous-`max_tokens`
 * reasoning. It returns only the text of proposed notes; the client decides where they go. Any
 * untrustworthy answer degrades to an empty reflection.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
	interpretReflection,
	NO_REFLECTION,
	REFLECT_SYSTEM_PROMPT,
	REFLECTION_SCHEMA,
	reflectModel,
	renderReflection,
	type Reflection,
	type ReflectPayload,
} from './reflectPrompt.ts'

// Lazy, like the other routes: a missing key degrades this to an empty reflection (handled by
// the route) rather than stopping the server from booting.
let anthropic: Anthropic | null = null
function client(): Anthropic {
	return (anthropic ??= new Anthropic())
}

export async function reflect(payload: ReflectPayload): Promise<Reflection> {
	const response = await client().messages.create({
		model: reflectModel(),
		max_tokens: 1024,
		system: REFLECT_SYSTEM_PROMPT,
		thinking: { type: 'disabled' },
		output_config: {
			// `format` takes `type` and `schema` only — an extra `name` is a 400. Keep exact.
			format: { type: 'json_schema', schema: REFLECTION_SCHEMA },
		},
		messages: [{ role: 'user', content: renderReflection(payload) }],
	})

	if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
		console.warn(`[reflect] no usable answer: stop_reason=${response.stop_reason}`)
		return NO_REFLECTION
	}

	const block = response.content.find((entry) => entry.type === 'text')
	if (!block || block.type !== 'text') return NO_REFLECTION

	return interpretReflection(block.text, payload.board)
}
