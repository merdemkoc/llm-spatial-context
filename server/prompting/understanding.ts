/**
 * The standing understanding, written for a model.
 *
 * One renderer for all three consumers, so they are given the same reading in the same words —
 * the whole point of deriving it once is that the agents stop each inventing their own.
 *
 * Staleness is stated, not merely tracked. A model told its context is old discounts it
 * correctly; a model shown stale context as fact does not, and this reading is out of date by
 * construction — it is derived every few changes, not every call.
 */
import type { BoardUnderstanding } from './types.ts'

/** How the reading's age is phrased. Drift, not seconds: changes are what makes it wrong. */
function staleness(driftSince: number | undefined): string {
	if (driftSince === undefined || driftSince <= 0) return 'It is current as of the change above.'
	return `It was taken ${driftSince} ${driftSince === 1 ? 'change' : 'changes'} ago, so parts of it may already be wrong.`
}

/** The understanding as background lines, or nothing at all when there is none. */
export function renderUnderstanding(
	understanding: BoardUnderstanding | undefined,
	driftSince: number | undefined
): string[] {
	if (!understanding) return []
	const { themes, reading, narrative, tensions } = understanding
	// An understanding with nothing in it is not context, it is noise.
	if (themes.length === 0 && reading === '' && narrative === '' && tensions.length === 0) return []

	const lines: string[] = [`What you understood this board to be. ${staleness(driftSince)}`]

	if (reading !== '') lines.push(`- In short: ${reading}`)
	for (const theme of themes) {
		const meaning = theme.meaning === '' ? '' : ` — ${theme.meaning}`
		lines.push(`- Theme "${theme.name}"${meaning}`)
	}
	if (narrative !== '') lines.push(`- The session so far: ${narrative}`)
	for (const tension of tensions) lines.push(`- Still unresolved: ${tension}`)

	lines.push('')
	return lines
}
