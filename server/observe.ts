/**
 * The observe endpoint's brain: one episode in, a speak/stay-silent decision out.
 *
 * Runs server-side so the Anthropic key never reaches the browser. The asking is shared
 * with its three siblings (`prompting/callStructured.ts`); what is left here is this agent's
 * own configuration — which model, which persona, how to render the question, and that an
 * untrustworthy answer means silence.
 */
import { callStructured } from './prompting/callStructured.ts'
import {
	DECISION_SCHEMA,
	interpretDecision,
	observerEffort,
	observerModel,
	renderEpisode,
	SILENCE,
	SYSTEM_PROMPT,
} from './prompt.ts'
import type { EpisodePayload, ObserverDecision } from './prompt.ts'

export type { ObserverDecision } from './prompt.ts'

export async function observe(payload: EpisodePayload): Promise<ObserverDecision> {
	return callStructured({
		tag: 'observe',
		model: observerModel(),
		system: SYSTEM_PROMPT,
		schema: DECISION_SCHEMA,
		user: renderEpisode(payload),
		interpret: interpretDecision,
		fallback: SILENCE,
		effort: observerEffort(),
	})
}
