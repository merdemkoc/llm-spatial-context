/**
 * The suggest endpoint's brain: the whole board in, a grouping proposal out.
 *
 * A sibling of `observe.ts`, sharing its asking (`prompting/callStructured.ts`) and
 * differing only in what it asks for. It never returns positions: the model names members,
 * the client arranges them. Any untrustworthy answer degrades to a decline.
 */
import { callStructured } from './prompting/callStructured.ts'
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

export async function suggest(payload: SuggestPayload): Promise<GroupingSuggestion> {
	return callStructured({
		tag: 'suggest',
		model: suggesterModel(),
		system: SUGGEST_SYSTEM_PROMPT,
		schema: GROUPING_SCHEMA,
		user: renderSuggestRequest(payload),
		interpret: (text) => interpretGrouping(text, payload.board),
		fallback: NO_GROUPING,
	})
}
