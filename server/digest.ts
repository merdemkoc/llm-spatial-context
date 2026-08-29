/**
 * The digest endpoint's brain: the whole board in, a standing understanding out.
 *
 * A fourth sibling of `observe.ts`, `suggest.ts` and `reflect.ts`, sharing their asking
 * (`prompting/callStructured.ts`). Its answer is stored by the client and injected into the
 * other three, so an untrustworthy one degrades to nothing understood rather than to a wrong
 * understanding held with confidence.
 */
import { callStructured } from './prompting/callStructured.ts'
import {
	DIGEST_SCHEMA,
	DIGEST_SYSTEM_PROMPT,
	digestModel,
	interpretUnderstanding,
	NO_UNDERSTANDING,
	renderDigestRequest,
	type BoardUnderstanding,
	type DigestPayload,
} from './digestPrompt.ts'

export async function digest(payload: DigestPayload): Promise<BoardUnderstanding> {
	return callStructured({
		tag: 'digest',
		model: digestModel(),
		system: DIGEST_SYSTEM_PROMPT,
		schema: DIGEST_SCHEMA,
		user: renderDigestRequest(payload),
		interpret: (text) => interpretUnderstanding(text, payload.board),
		fallback: NO_UNDERSTANDING,
	})
}
