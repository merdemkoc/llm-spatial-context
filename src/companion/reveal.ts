/**
 * How much of a remark has been said out loud.
 *
 * The companion's voice is a finished mp3 with no word timings — OpenAI's speech API does
 * not return them — so the reveal is estimated from position rather than measured: a word
 * appears when playback has travelled its share of the sentence's characters. Long words
 * therefore hold longer than short ones, which is roughly how speech behaves.
 *
 * Position, not a clock. The caller feeds a fraction read from the audio element itself, so
 * a slow start, a buffering pause or a `stop()` mid-sentence all carry through instead of
 * drifting away from a schedule that was set when playback began.
 *
 * A word is revealed when it *starts* being spoken, not when it finishes: the reader should
 * be seeing the word they are hearing.
 */

/**
 * The words of `comment` spoken by `fraction` of the way through it (0–1).
 *
 * The first word is always included, so the chip never renders empty at the moment the
 * voice starts.
 */
export function spokenPrefix(comment: string, fraction: number): string {
	if (fraction >= 1) return comment
	if (comment.length === 0) return comment

	const threshold = Math.max(0, fraction) * comment.length

	// Words at the even indices, the whitespace between them at the odd ones, so the
	// positions below stay true to the original string — including its double spaces.
	const tokens = comment.split(/(\s+)/)

	let position = 0
	let spokenTo = 0
	let words = 0

	for (const token of tokens) {
		const isWord = token.length > 0 && !/^\s+$/.test(token)

		if (isWord) {
			if (position > threshold && words > 0) break
			spokenTo = position + token.length
			words += 1
		}

		position += token.length
	}

	return comment.slice(0, spokenTo)
}
