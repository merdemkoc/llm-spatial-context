/**
 * How a post-it's provenance shows in its border.
 *
 * A note the agent authored reads as AI-made at a glance: a heavier border in the agent ink,
 * distinct from the user's own stroke. The rendering is a tldraw concern, but the decision is
 * pure and worth pinning here.
 */
import { describe, expect, it } from 'vitest'
import { AGENT_INK } from '@/canvas/ui/theme'
import { isAgentAuthored, postItBorder } from '@/canvas/shapes/postItAppearance'

describe('isAgentAuthored', () => {
	it('is true only for the agent', () => {
		expect(isAgentAuthored('agent')).toBe(true)
		expect(isAgentAuthored('user')).toBe(false)
		expect(isAgentAuthored('system')).toBe(false)
		expect(isAgentAuthored(undefined)).toBe(false)
	})
})

describe('postItBorder', () => {
	it("uses the note's own stroke for a user note", () => {
		expect(postItBorder('user', '#000000')).toBe('1px solid #000000')
	})

	it('gives an agent note a heavier border in the agent ink', () => {
		const border = postItBorder('agent', '#000000')
		expect(border).toContain(AGENT_INK)
		expect(border).not.toContain('#000000')
		expect(border).toContain('2px')
	})
})
