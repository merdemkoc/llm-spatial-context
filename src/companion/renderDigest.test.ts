/**
 * What the digest reads, and how its answer is trusted.
 *
 * The digest is the only agent whose output is not spoken but *stored*, then injected into
 * every other agent — so a hallucinated theme does not embarrass one remark, it poisons every
 * remark until the next derivation. `interpretUnderstanding` is correspondingly strict.
 *
 * The module lives in `server/`, which Vite's `@` alias does not cover, so it is imported by
 * relative path, like `renderEpisode`.
 */
import { describe, expect, it } from 'vitest'
import {
	DIGEST_SYSTEM_PROMPT,
	interpretUnderstanding,
	MAX_TENSIONS,
	MAX_THEMES,
	NO_UNDERSTANDING,
	renderDigestRequest,
} from '../../server/digestPrompt.ts'

const board = {
	nodeCount: 4,
	nodes: [
		{ id: 'a', text: 'pricing is the blocker' },
		{ id: 'b', text: 'SSO keeps coming up in calls' },
		{ id: 'c', text: 'onboarding friction' },
		{ id: 'd', text: 'activation email sequence' },
	],
	clusters: [{ members: ['c', 'd'] }],
	loners: ['a', 'b'],
	proximities: [{ source: 'c', target: 'd', influence: 0.7 }],
	relations: [{ source: 'a', target: 'b', gravity: 0.8, type: 'blocks' }],
	effectiveStrengths: [{ source: 'c', target: 'd', effectiveStrength: 0.7 }],
	truncated: false,
}

const ok = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		themes: [
			{ name: 'Deal friction', meaning: 'What stalls enterprise deals', members: ['a', 'b'] },
		],
		reading: 'A board about why deals stall.',
		narrative: 'Started at pricing, kept returning to SSO.',
		tensions: ['Nothing says whether onboarding causes churn or follows it.'],
		...over,
	})

describe('DIGEST_SYSTEM_PROMPT', () => {
	it('explains the canvas, like every other agent', () => {
		expect(DIGEST_SYSTEM_PROMPT).toContain('"influence"')
		expect(DIGEST_SYSTEM_PROMPT).toContain('"gravity"')
	})
})

describe('renderDigestRequest', () => {
	it('gives the model every note in full with its id', () => {
		const rendered = renderDigestRequest({ board })
		expect(rendered).toContain('pricing is the blocker')
		expect(rendered).toContain('[a]')
	})

	it('passes the session transcript so the narrative is about the arc', () => {
		const rendered = renderDigestRequest({ board, recentComments: ['Those two converged.'] })
		expect(rendered).toContain('Those two converged.')
	})

	it('renders an empty board without throwing', () => {
		expect(() => renderDigestRequest({})).not.toThrow()
	})
})

describe('interpretUnderstanding', () => {
	it('keeps a well-formed reading', () => {
		const result = interpretUnderstanding(ok(), board)
		expect(result.themes).toHaveLength(1)
		expect(result.themes[0].members).toEqual(['a', 'b'])
		expect(result.reading).toBe('A board about why deals stall.')
		expect(result.narrative).toBe('Started at pricing, kept returning to SSO.')
		expect(result.tensions).toHaveLength(1)
	})

	it('records which notes the reading was taken from', () => {
		expect(interpretUnderstanding(ok(), board).derivedFromNodes).toEqual(['a', 'b', 'c', 'd'])
	})

	it('drops a theme naming notes that do not exist', () => {
		const themes = [{ name: 'Ghosts', meaning: 'Not real', members: ['zz', 'yy'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes).toEqual([])
	})

	it('drops a theme left with fewer than two real members', () => {
		const themes = [{ name: 'Lonely', meaning: 'One idea', members: ['a', 'zz'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes).toEqual([])
	})

	it('dedupes repeated members', () => {
		const themes = [{ name: 'Dupes', meaning: 'Same twice', members: ['a', 'a', 'b'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes[0].members).toEqual(['a', 'b'])
	})

	it('caps the number of themes', () => {
		const themes = Array.from({ length: MAX_THEMES + 3 }, (_, i) => ({
			name: `T${i}`,
			meaning: 'x',
			members: ['a', 'b'],
		}))
		expect(interpretUnderstanding(ok({ themes }), board).themes).toHaveLength(MAX_THEMES)
	})

	it('caps the number of tensions', () => {
		const tensions = Array.from({ length: MAX_TENSIONS + 3 }, (_, i) => `tension ${i}`)
		expect(interpretUnderstanding(ok({ tensions }), board).tensions).toHaveLength(MAX_TENSIONS)
	})

	it('blanks prose that leaked scaffolding rather than storing it', () => {
		const result = interpretUnderstanding(ok({ reading: 'A board.}  Actually: {' }), board)
		expect(result.reading).toBe('')
		// The rest of the reading survives — one bad field is not a bad digest.
		expect(result.narrative).not.toBe('')
	})

	it('drops a theme whose name leaked scaffolding', () => {
		const themes = [{ name: 'Deal friction}  {', meaning: 'x', members: ['a', 'b'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes).toEqual([])
	})

	it('returns nothing understood rather than throwing on unparseable output', () => {
		expect(interpretUnderstanding('not json', board)).toEqual(NO_UNDERSTANDING)
	})
})
