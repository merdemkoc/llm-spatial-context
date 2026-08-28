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
import { interpretGrouping, renderSuggestRequest } from '../../server/suggestPrompt.ts'

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
})

describe('interpretGrouping', () => {
	it('accepts a grouping of two or more real ids with a rationale', () => {
		const result = interpretGrouping(
			JSON.stringify({ suggest: true, members: ['c', 'd'], comment: 'Both are growth loops.' }),
			board
		)

		expect(result).toEqual({ suggest: true, members: ['c', 'd'], comment: 'Both are growth loops.' })
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
