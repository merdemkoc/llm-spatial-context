/**
 * The one call every agent makes.
 *
 * The observer, the suggester and the reflection differ in what they ask and how they read
 * the answer; the mechanics of asking were identical in all three, down to a copy of the
 * same warning comment. That is what lives here: the client, the request shape, and the
 * rule that an answer which cannot be trusted becomes the agent's own safe fallback.
 *
 * **Thinking is on, and that is a correctness fix rather than a quality one.** It used to be
 * disabled, on the reasoning that a one-or-two-sentence judgement is not worth the latency.
 * Both halves of that turned out to be wrong when measured (`evals/`).
 *
 * With thinking off, the model still reasons — it just has nowhere legal to put it. Structured
 * output constrains generation to valid JSON, so when the model tried to stop and start over
 * the continuation was absorbed into the only string open at the time: `comment`. The result
 * was a schema-valid answer carrying a remark like `"...worth noticing.}  Actually: {"`, up to
 * 1040 characters of it, sent straight to the voice. The schema guarantees shape, not sanity.
 *
 * Turning thinking on gives that reasoning a home and the leak disappears. It also did not
 * cost the latency it was disabled to save — the measured difference across the corpus was
 * within noise, and the pause the companion's feel depends on is dominated by synthesis
 * anyway. `max_tokens` is generous because it caps thinking *plus* text; a tight cap could be
 * spent reasoning and return truncated JSON, which parses to nothing and is indistinguishable
 * from a considered silence.
 */
import Anthropic from '@anthropic-ai/sdk'

/**
 * Room for thinking plus the answer. Headroom, not a target: unused tokens cost nothing, and
 * a truncated response is indistinguishable from a considered decline.
 */
export const MAX_TOKENS = 2048

// Constructed lazily and shared: the SDK throws at construction when no key is set, and the
// server must boot and serve the app regardless — a missing key degrades each agent to its
// fallback (handled by the route), it does not stop the process from starting.
let anthropic: Anthropic | null = null
function client(): Anthropic {
	return (anthropic ??= new Anthropic())
}

export interface StructuredCall<T> {
	/** Prefix for the warn logs, e.g. `observe`. */
	tag: string
	model: string
	system: string
	/** The JSON schema the answer must satisfy. Indexed, as the SDK's param type requires. */
	schema: { [key: string]: unknown }
	/** The rendered user message. */
	user: string
	/** Turn the model's raw text into the agent's answer. Must not throw. */
	interpret: (text: string) => T
	/** The answer to give when nothing usable came back. */
	fallback: T
	/**
	 * Reasoning effort, when the caller wants to override the API's default of `high`.
	 * Left unset in normal operation; the eval harness sets it to measure the trade.
	 */
	effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

/**
 * Ask one agent's question and read its answer, or fall back.
 *
 * Uses structured output so a decline is a first-class, parseable answer rather than
 * something to detect in prose.
 */
export async function callStructured<T>({
	tag,
	model,
	system,
	schema,
	user,
	interpret,
	fallback,
	effort,
}: StructuredCall<T>): Promise<T> {
	const response = await client().messages.create({
		model,
		max_tokens: MAX_TOKENS,
		system,
		// Adaptive rather than off: see the note above on the leak that disabling it caused.
		thinking: { type: 'adaptive' },
		output_config: {
			// `format` takes `type` and `schema` only. An extra `name` here (an OpenAI-ism)
			// is rejected with a 400, which the routes turn into a fallback — so the companion
			// looks thoughtful while being entirely broken. Keep this shape exact.
			format: { type: 'json_schema', schema },
			// Omitted entirely when unset, so the default is whatever the API's is.
			...(effort ? { effort } : {}),
		},
		messages: [{ role: 'user', content: user }],
	})

	// A refusal or a truncated response is not a decision. Say so in the log rather than
	// letting it read as the model choosing to decline.
	if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
		console.warn(`[${tag}] no usable answer: stop_reason=${response.stop_reason}`)
		return fallback
	}

	const block = response.content.find((entry) => entry.type === 'text')
	if (!block || block.type !== 'text') return fallback

	return interpret(block.text)
}
