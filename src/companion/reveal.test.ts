/**
 * The spoken prefix, which is what makes the text arrive with the voice rather than ahead
 * of it. Pure and position-based, so it can be checked without an audio element.
 */
import { describe, expect, it } from 'vitest'
import { spokenPrefix } from '@/companion/reveal'

const REMARK = 'Those two ideas are converging.'

describe('spokenPrefix', () => {
	it('shows the first word as soon as the voice starts', () => {
		// Never empty at fraction 0: the chip would flicker blank at the moment it appears.
		expect(spokenPrefix(REMARK, 0)).toBe('Those')
	})

	it('grows a word at a time as playback advances', () => {
		const prefixes = [0.2, 0.4, 0.6, 0.8].map((fraction) => spokenPrefix(REMARK, fraction))

		expect(prefixes).toEqual([
			'Those two',
			'Those two ideas',
			'Those two ideas are',
			'Those two ideas are converging.',
		])
		// Monotonic, so a word can never disappear again mid-sentence.
		for (let i = 1; i < prefixes.length; i++) {
			expect(prefixes[i].startsWith(prefixes[i - 1])).toBe(true)
		}
	})

	it('has the whole remark by the end', () => {
		expect(spokenPrefix(REMARK, 1)).toBe(REMARK)
		// Overshoot is possible: `currentTime` can pass `duration` by a frame.
		expect(spokenPrefix(REMARK, 1.4)).toBe(REMARK)
	})

	it('weights a word by its length, because a long word takes longer to say', () => {
		// 'extraordinarily' occupies most of this sentence's characters, so it is still
		// being said well past the halfway point.
		const sentence = 'An extraordinarily long word ends it'
		expect(spokenPrefix(sentence, 0.5)).toBe('An extraordinarily')
		expect(spokenPrefix(sentence, 0.6)).toBe('An extraordinarily long')
	})

	it('keeps the original spacing rather than re-joining words', () => {
		expect(spokenPrefix('Two  spaces here', 0.5)).toBe('Two  spaces')
	})

	it('handles a single word and an empty remark', () => {
		expect(spokenPrefix('Converging.', 0)).toBe('Converging.')
		expect(spokenPrefix('', 0.5)).toBe('')
	})

	it('treats a negative fraction as the start', () => {
		expect(spokenPrefix(REMARK, -1)).toBe('Those')
	})
})
