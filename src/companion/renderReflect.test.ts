/**
 * What the reflection reads, and how its answer is trusted.
 *
 * Unlike the observer's compact board or the suggester's id list, `renderReflection` hands
 * the model the whole board in full — every note's complete text, every relation with its
 * gravity and label, what sits close and what stands alone — and asks for a reading of the
 * board plus a few new ideas or questions. `interpretReflection` guards the answer: it keeps
 * the comment and only the well-formed idea suggestions, capped, and collapses anything
 * unusable to an empty reflection.
 *
 * The module lives in `server/`, which Vite's `@` alias does not cover, so it is imported by
 * relative path, like `renderEpisode`.
 */
import { describe, expect, it } from 'vitest'
import {
	interpretReflection,
	MAX_IDEAS,
	REFLECT_PERSONAS,
	renderReflection,
} from '../../server/reflectPrompt.ts'

const longText = 'onboarding is where new teams either get to their first win or quietly churn out'

const board = {
	nodeCount: 4,
	nodes: [
		{ id: 'a', text: longText, hasField: true },
		{ id: 'b', text: 'activation email', hasField: true },
		{ id: 'c', text: 'cohort retention', hasField: false },
		{ id: 'd', text: 'pricing tiers', hasField: false },
	],
	clusters: [{ members: ['a', 'b'] }],
	loners: ['c', 'd'],
	proximities: [{ source: 'a', target: 'b', influence: 0.8 }],
	relations: [{ source: 'a', target: 'b', gravity: 0.8, type: 'leads to' }],
	effectiveStrengths: [{ source: 'a', target: 'b', effectiveStrength: 0.82 }],
	truncated: false,
}

describe('renderReflection', () => {
	it('gives the model each note in full, not truncated', () => {
		const rendered = renderReflection({ board })
		expect(rendered).toContain(longText)
	})

	it('states connections with their gravity and label', () => {
		const rendered = renderReflection({ board })
		expect(rendered).toContain('leads to')
		expect(rendered).toContain('0.8')
	})

	it('asks for a reading of the board plus new ideas or questions', () => {
		const rendered = renderReflection({ board }).toLowerCase()
		expect(rendered).toContain('idea')
		expect(rendered).toContain('question')
	})

	it('frames the reading around a recent change and asks how it affects the whole board', () => {
		const rendered = renderReflection({ board, recentChange: 'grouped the revenue ideas together' })
		expect(rendered).toContain('grouped the revenue ideas together')
		expect(rendered.toLowerCase()).toContain('affect')
	})

	it('takes on a critique persona and only comments, proposing no notes', () => {
		const rendered = renderReflection({ board, persona: 'critique' }).toLowerCase()
		expect(rendered).toContain('challenge')
		expect(rendered).toContain('do not propose')
	})

	it('takes on an analyzer persona reading the structure, comment only', () => {
		const rendered = renderReflection({ board, persona: 'analyzer' }).toLowerCase()
		expect(rendered).toContain('structure')
		expect(rendered).toContain('do not propose')
	})

	it('takes on a gap-finder persona that proposes the missing notes', () => {
		const rendered = renderReflection({ board, persona: 'gap-finder' }).toLowerCase()
		expect(rendered).toContain('missing')
		expect(rendered).toContain('propose up to')
	})

	it('defaults an unknown persona to a synthesizer that proposes ideas', () => {
		const rendered = renderReflection({ board, persona: 'nonsense' }).toLowerCase()
		expect(rendered).toContain('propose up to')
	})

	it('shows note ids and asks which notes the comment is about', () => {
		const rendered = renderReflection({ board, persona: 'analyzer' })
		expect(rendered).toContain('[a]')
		expect(rendered.toLowerCase()).toContain('focus')
	})

	it('invites the model to propose connections for a persona that adds to the board', () => {
		const rendered = renderReflection({ board, persona: 'gap-finder' }).toLowerCase()
		expect(rendered).toContain('connect')
	})

	it('reads a recent change through the impact lens, not a user-chosen one', () => {
		const rendered = renderReflection({ board, recentChange: 'added 2 new ideas' })
		// The lens is stated, like every other persona's — the change-comment used to have none.
		expect(rendered).toContain(REFLECT_PERSONAS.impact.lens)
		expect(rendered).toContain('What just happened: added 2 new ideas.')
		expect(rendered).toContain(REFLECT_PERSONAS.impact.instruction!)
	})

	it('lets a chosen persona lose to the impact lens when a change is present', () => {
		const rendered = renderReflection({
			board,
			persona: 'critique',
			recentChange: 'drew 1 new connection',
		})
		expect(rendered).toContain(REFLECT_PERSONAS.impact.lens)
		expect(rendered).not.toContain(REFLECT_PERSONAS.critique.lens)
	})

	it('passes recent comments through so a reading can vary from itself', () => {
		const rendered = renderReflection({
			board,
			persona: 'critique',
			recentComments: ['The board leans hard on onboarding.'],
		})
		expect(rendered).toContain('You recently said')
		expect(rendered).toContain('The board leans hard on onboarding.')
	})

	it('omits the recent-comment block when there is no history', () => {
		expect(renderReflection({ board })).not.toContain('You recently said')
	})
})

describe('interpretReflection relations', () => {
	it('keeps proposed relations between real, distinct notes and drops the rest', () => {
		const result = interpretReflection(
			JSON.stringify({
				comment: 'x',
				ideas: [],
				focus: [],
				relations: [
					{ from: 'a', to: 'b', label: 'leads to' },
					{ from: 'a', to: 'a', label: 'self' },
					{ from: 'a', to: 'ghost', label: 'nope' },
				],
			}),
			board
		)
		expect(result.relations).toEqual([{ from: 'a', to: 'b', label: 'leads to' }])
	})

	it('resolves a new idea that connects to an existing note', () => {
		const result = interpretReflection(
			JSON.stringify({
				comment: 'x',
				focus: [],
				relations: [],
				ideas: [{ text: 'metric', kind: 'idea', connectTo: 'a', connectLabel: 'measures' }],
			}),
			board
		)
		expect(result.ideas[0]).toEqual({
			text: 'metric',
			kind: 'idea',
			connectTo: 'a',
			connectLabel: 'measures',
		})
	})

	it('drops a connectTo that is not a real note', () => {
		const result = interpretReflection(
			JSON.stringify({
				comment: 'x',
				focus: [],
				relations: [],
				ideas: [{ text: 'm', kind: 'idea', connectTo: 'ghost', connectLabel: 'x' }],
			}),
			board
		)
		expect(result.ideas[0]).toEqual({ text: 'm', kind: 'idea' })
	})
})

describe('interpretReflection', () => {
	it('keeps the comment and the well-formed ideas, preserving kind', () => {
		const result = interpretReflection(
			JSON.stringify({
				comment: 'The board is really about activation, not pricing.',
				ideas: [
					{ text: 'time-to-first-value metric', kind: 'idea' },
					{ text: 'what makes a team stick past week one?', kind: 'question' },
				],
			})
		)

		expect(result.comment).toBe('The board is really about activation, not pricing.')
		expect(result.ideas).toEqual([
			{ text: 'time-to-first-value metric', kind: 'idea' },
			{ text: 'what makes a team stick past week one?', kind: 'question' },
		])
	})

	it('defaults an unknown or missing kind to idea', () => {
		const result = interpretReflection(
			JSON.stringify({
				comment: 'x',
				ideas: [{ text: 'a thought' }, { text: 'b', kind: 'nonsense' }],
			})
		)
		expect(result.ideas.map((i) => i.kind)).toEqual(['idea', 'idea'])
	})

	it('drops ideas with no text', () => {
		const result = interpretReflection(
			JSON.stringify({
				comment: 'x',
				ideas: [
					{ text: '   ', kind: 'idea' },
					{ text: 'real', kind: 'idea' },
				],
			})
		)
		expect(result.ideas).toEqual([{ text: 'real', kind: 'idea' }])
	})

	it('caps the number of ideas', () => {
		const many = Array.from({ length: MAX_IDEAS + 4 }, (_, i) => ({
			text: `idea ${i}`,
			kind: 'idea',
		}))
		const result = interpretReflection(JSON.stringify({ comment: 'x', ideas: many }))
		expect(result.ideas).toHaveLength(MAX_IDEAS)
	})

	it('accepts a comment with no ideas', () => {
		const result = interpretReflection(
			JSON.stringify({ comment: 'Just an observation.', ideas: [] })
		)
		expect(result).toEqual({ comment: 'Just an observation.', ideas: [], focus: [], relations: [] })
	})

	it('declines rather than throwing on unparseable output', () => {
		expect(interpretReflection('not json')).toEqual({
			comment: '',
			ideas: [],
			focus: [],
			relations: [],
		})
	})

	it('keeps focus ids that exist on the board, dropping and deduping the rest', () => {
		const result = interpretReflection(
			JSON.stringify({ comment: 'x', ideas: [], focus: ['a', 'ghost', 'b', 'a'] }),
			board
		)
		expect(result.focus).toEqual(['a', 'b'])
	})

	it('defaults focus to empty when the model names none', () => {
		const result = interpretReflection(JSON.stringify({ comment: 'x', ideas: [] }), board)
		expect(result.focus).toEqual([])
	})
})

describe('renderReflection with a standing understanding', () => {
	const understanding = {
		themes: [{ name: 'Deal friction', meaning: 'What stalls deals', members: ['a', 'b'] }],
		reading: 'A board about why deals stall.',
		narrative: '',
		tensions: [],
		derivedFromNodes: ['a', 'b'],
	}

	it('states the themes it already believes in, so it does not re-propose them', () => {
		const rendered = renderReflection({ board, persona: 'critique', understanding })
		expect(rendered).toContain('Deal friction')
	})

	it('omits the section when there is no understanding', () => {
		expect(renderReflection({ board, persona: 'critique' })).not.toContain(
			'understood this board to be'
		)
	})

	// The triage travels with the data (`renderUnderstanding`), not with the persona, so every
	// consumer that is handed an understanding gets it and none that isn't ever sees it.
	it('carries the fits/extends/contradicts triage whenever an understanding is supplied', () => {
		const rendered = renderReflection({ board, persona: 'critique', understanding })
		expect(rendered).toContain('never itself a reason to speak')
	})

	it('omits the triage entirely when there is no understanding', () => {
		expect(renderReflection({ board, persona: 'critique' })).not.toContain(
			'never itself a reason to speak'
		)
	})
})
