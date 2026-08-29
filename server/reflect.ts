/**
 * The reflect endpoint's brain: the whole board in, a reading plus new ideas out.
 *
 * A sibling of `observe.ts` and `suggest.ts`, sharing their asking
 * (`prompting/callStructured.ts`). It returns only the text of proposed notes; the client
 * decides where they go. Any untrustworthy answer degrades to an empty reflection.
 */
import { callStructured } from './prompting/callStructured.ts'
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

export async function reflect(payload: ReflectPayload): Promise<Reflection> {
	return callStructured({
		tag: 'reflect',
		model: reflectModel(),
		system: REFLECT_SYSTEM_PROMPT,
		schema: REFLECTION_SCHEMA,
		user: renderReflection(payload),
		interpret: (text) => interpretReflection(text, payload.board),
		fallback: NO_REFLECTION,
	})
}
