/**
 * What the suggester reads, and how its answer is trusted.
 *
 * `renderSuggestRequest` turns the board into the model's prompt — and unlike the
 * observer's, it must show ids, because the model echoes them back as the grouping's
 * members. `interpretGrouping` is the guard on that answer: structured output cannot
 * enforce "two or more real ids", so this does, and a weak answer collapses to "no
 * grouping" rather than a broken one.
 *
 * The module lives in `server/`, which Vite's `@` alias does not cover, so it is
 * imported by relative path, like `renderEpisode`.
 */
import { describe, expect, it } from 'vitest'
import {
	interpretGrouping,
	renderSuggestRequest,
	SUGGEST_SYSTEM_PROMPT,
} from '../../server/suggestPrompt.ts'

const board = {
	nodeCount: 4,
	nodes: [
		{ id: 'a', text: 'onboarding', hasField: true },
		{ id: 'b', text: 'activation email', hasField: true },
		{ id: 'c', text: 'cohort retention', hasField: false },
		{ id: 'd', text: 'referral loop', hasField: false },
	],
	clusters: [{ members: ['a', 'b'] }],
	loners: ['c', 'd'],
	proximities: [{ source: 'a', target: 'b', influence: 0.8 }],
	relations: [{ source: 'c', target: 'd', gravity: 1, type: 'feeds' }],
	effectiveStrengths: [],
	truncated: false,
}

describe('renderSuggestRequest', () => {
	it('lists every idea with its exact id so the model can echo it', () => {
		const rendered = renderSuggestRequest({ board, trigger: 'demand', recentComments: [] })

		expect(rendered).toContain('"onboarding" [a]')
		expect(rendered).toContain('"referral loop" [d]')
	})

	it('asks for at most one grouping and allows declining', () => {
		const rendered = renderSuggestRequest({ board, trigger: 'demand', recentComments: [] })

		expect(rendered.toLowerCase()).toContain('grouping')
		expect(rendered).toContain('suggest=false')
	})

	it('raises the bar for an unprompted, proactive request', () => {
		const proactive = renderSuggestRequest({ board, trigger: 'proactive', recentComments: [] })
		const demand = renderSuggestRequest({ board, trigger: 'demand', recentComments: [] })

		expect(proactive).toContain('unprompted')
		expect(demand).not.toContain('unprompted')
	})

	it("states the user's grouping intent when given", () => {
		const rendered = renderSuggestRequest({
			board,
			trigger: 'demand',
			recentComments: [],
			intent: 'group by user-journey stage',
		})
		expect(rendered).toContain('user-journey stage')
	})

	it('gives the model each note in full, not truncated', () => {
		const longText =
			'onboarding is where new teams either reach their first win or quietly churn away'
		const longBoard = {
			...board,
			nodes: [{ id: 'a', text: longText, hasField: true }, ...board.nodes.slice(1)],
		}
		const rendered = renderSuggestRequest({
			board: longBoard,
			trigger: 'demand',
			recentComments: [],
		})
		expect(rendered).toContain(longText)
	})

	it('states which ideas are notably close, so it understands the placement', () => {
		const rendered = renderSuggestRequest({ board, trigger: 'demand', recentComments: [] })
		// proximities carries a↔b; both must surface in a closeness line.
		expect(rendered.toLowerCase()).toContain('close')
		expect(rendered).toContain('"onboarding"')
		expect(rendered).toContain('"activation email"')
	})
})

describe('interpretGrouping', () => {
	it('accepts a grouping of two or more real ids with a rationale', () => {
		const result = interpretGrouping(
			JSON.stringify({ suggest: true, members: ['c', 'd'], comment: 'Both are growth loops.' }),
			board
		)

		expect(result).toEqual({
			suggest: true,
			members: ['c', 'd'],
			comment: 'Both are growth loops.',
		})
	})

	it('drops ids that are not on the board, declining if fewer than two survive', () => {
		const result = interpretGrouping(
			JSON.stringify({ suggest: true, members: ['c', 'ghost'], comment: 'x' }),
			board
		)

		expect(result).toEqual({ suggest: false, members: [], comment: '' })
	})

	it('dedupes repeated ids', () => {
		const result = interpretGrouping(
			JSON.stringify({ suggest: true, members: ['c', 'd', 'c'], comment: 'paired' }),
			board
		)

		expect(result.members).toEqual(['c', 'd'])
	})

	it('treats suggest=false as no grouping', () => {
		const result = interpretGrouping(
			JSON.stringify({ suggest: false, members: [], comment: '' }),
			board
		)

		expect(result).toEqual({ suggest: false, members: [], comment: '' })
	})

	it('declines when the rationale is empty', () => {
		const result = interpretGrouping(
			JSON.stringify({ suggest: true, members: ['c', 'd'], comment: '   ' }),
			board
		)

		expect(result.suggest).toBe(false)
	})

	it('declines rather than throwing on unparseable output', () => {
		expect(interpretGrouping('not json at all', board)).toEqual({
			suggest: false,
			members: [],
			comment: '',
		})
	})
})

describe('SUGGEST_SYSTEM_PROMPT', () => {
	it('explains proximity, which it is shown but was never told the meaning of', () => {
		// `renderSuggestRequest` states which ideas are "notably close on the board"; without
		// the primer the suggester read that signal with no idea what it measured.
		expect(SUGGEST_SYSTEM_PROMPT).toContain('"influence"')
		expect(SUGGEST_SYSTEM_PROMPT).toContain('"gravity"')
	})
})

describe('renderSuggestRequest with a standing understanding', () => {
	it('states the themes it already believes in, so it does not re-propose them', () => {
		const rendered = renderSuggestRequest({
			board,
			understanding: {
				themes: [{ name: 'Deal friction', meaning: 'What stalls deals', members: ['a', 'b'] }],
				reading: 'A board about why deals stall.',
				narrative: '',
				tensions: [],
				derivedFromNodes: ['a', 'b'],
			},
		})
		expect(rendered).toContain('Deal friction')
	})

	it('omits the section when there is no understanding', () => {
		expect(renderSuggestRequest({ board })).not.toContain('understood this board to be')
	})

	// The triage travels with the data (`renderUnderstanding`), not with the persona, so every
	// consumer that is handed an understanding gets it and none that isn't ever sees it.
	it('carries the fits/extends/contradicts triage whenever an understanding is supplied', () => {
		const rendered = renderSuggestRequest({
			board,
			understanding: {
				themes: [{ name: 'Deal friction', meaning: 'What stalls deals', members: ['a', 'b'] }],
				reading: 'A board about why deals stall.',
				narrative: '',
				tensions: [],
				derivedFromNodes: ['a', 'b'],
			},
		})
		expect(rendered).toContain('never itself a reason to speak')
	})

	it('omits the triage entirely when there is no understanding', () => {
		expect(renderSuggestRequest({ board })).not.toContain('never itself a reason to speak')
	})
})
