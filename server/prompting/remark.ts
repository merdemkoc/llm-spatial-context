/**
 * Is this actually a remark?
 *
 * Structured output guarantees the answer's *shape*. It does not guarantee that the string in
 * the `comment` field is a sentence someone should hear. Generation is constrained to valid
 * JSON, so when the model has text it cannot place — a restart, a stray brace, reasoning with
 * nowhere to go — the grammar's only legal home for it is whichever string is open. That is
 * how a schema-valid decision came to carry `"...worth noticing.}  Actually: {"`, and 1040
 * characters of leaked prompt, on its way to the voice.
 *
 * Enabling thinking removed the cause (see `callStructured.ts`). This is the second layer:
 * cheap, content-blind, and it fails toward the agent's own safe answer rather than toward
 * speech. It rejects rather than truncates — half a leaked sentence is not an improvement on
 * a whole one, and a remark that reads as corrupt is better not said at all.
 */

/**
 * Longest a real remark can be.
 *
 * Well above the ~140-character style target the prompts ask for, and well below the leaks
 * this exists to catch. The gap is deliberate: overshooting the target is a style question
 * the eval reports on, not a reason to throw away a good sentence.
 */
export const REMARK_HARD_LIMIT = 400

/** Fragments that mean the model's own scaffolding has leaked into the sentence. */
const LEAKED = [
	'"speak"',
	'"comment"',
	'"suggest"',
	'interaction episode just finished',
	'The board as a whole right now',
	'Here is the whole board',
]

/** True when `text` reads as a remark rather than as spillage. */
export function isCleanRemark(text: string): boolean {
	if (text.length > REMARK_HARD_LIMIT) return false
	// Braces are never part of a spoken sentence about ideas, and they are the first thing to
	// appear when the JSON boundary is what leaked.
	if (/[{}]/.test(text)) return false
	return !LEAKED.some((fragment) => text.includes(fragment))
}
