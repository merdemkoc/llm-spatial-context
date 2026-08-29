/**
 * What the model actually reads.
 *
 * `renderEpisode` is the last step before the prompt, and the one place where a silent
 * mistake is invisible: a payload rendered as opaque shape ids still produces a fluent
 * remark, just a meaningless one. These tests pin the things the spec depends on — that
 * note text reaches the model, that a standing relation is stated even when the episode
 * never touched it, and that the transitions the domain classified survive.
 *
 * The module under test lives in `server/`, which Vite's `@` alias does not cover, so it
 * is imported by relative path.
 */
import { describe, expect, it } from 'vitest'
import { interpretDecision, renderEpisode, SILENCE, SYSTEM_PROMPT } from '../../server/prompt.ts'

describe('renderEpisode', () => {
	it('names ideas by their note text rather than their ids', () => {
		const rendered = renderEpisode({
			episode: {
				structural: [],
				pairs: [
					{
						source: 'shape:V1StGXR8',
						target: 'shape:aBc123',
						before: { influence: 0.04 },
						after: { influence: 0.58 },
						transitions: ['influence_changed'],
					},
				],
			},
			context: {
				labels: { 'shape:V1StGXR8': 'pricing page', 'shape:aBc123': 'onboarding flow' },
				relations: [],
			},
			recentComments: [],
		})

		expect(rendered).toContain('"pricing page"')
		expect(rendered).toContain('"onboarding flow"')
		expect(rendered).not.toContain('shape:V1StGXR8')
	})

	it('says an idea is untitled rather than inventing a name', () => {
		const rendered = renderEpisode({
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'shape:x' }],
				pairs: [],
			},
			context: { labels: {}, relations: [] },
			recentComments: [],
		})

		expect(rendered).toContain('untitled idea')
	})

	// MVP-2 Example 4: an arrow kept while the notes are pulled apart. The episode reports
	// only that influence fell, so without the standing relation the divergence is invisible.
	it('states a relation that already existed, not just ones this episode created', () => {
		const rendered = renderEpisode({
			episode: {
				structural: [],
				pairs: [
					{
						source: 'a',
						target: 'b',
						before: { distance: 150, influence: 0.7 },
						after: { distance: 700, influence: 0 },
						transitions: ['field_exited'],
					},
				],
			},
			context: {
				labels: { a: 'cost', b: 'quality' },
				relations: [{ source: 'a', target: 'b', gravity: 1, type: 'constrains' }],
			},
			recentComments: [],
		})

		expect(rendered).toContain('Explicit relations that currently exist')
		expect(rendered).toContain('constrains')
		expect(rendered).toContain('left its context')
	})

	it('renders a proximity band crossing in words', () => {
		const rendered = renderEpisode({
			episode: {
				structural: [],
				pairs: [
					{
						source: 'a',
						target: 'b',
						before: { influence: 0.4 },
						after: { influence: 0.8 },
						transitions: ['proximity_changed:strong'],
					},
				],
			},
			context: { labels: { a: 'one', b: 'two' }, relations: [] },
			recentComments: [],
		})

		expect(rendered).toContain('crossed into strong proximity')
	})

	it('passes recent comments through so the model can vary from them', () => {
		const rendered = renderEpisode({
			episode: { structural: [], pairs: [] },
			context: { labels: {}, relations: [] },
			recentComments: ['said this already'],
		})

		expect(rendered).toContain('said this already')
	})

	// Every field is optional on the wire. A payload missing one must not throw — a thrown
	// render is caught upstream and returned as silence, which reads as a considered pause.
	it('renders an empty payload without throwing', () => {
		expect(() => renderEpisode({})).not.toThrow()
	})

	// The whole-board summary is context, not the subject: it lets a remark know whether a
	// moved idea is joining or leaving a cluster without the model having to reconstruct it.
	it('states the whole board as background when a board summary is present', () => {
		const rendered = renderEpisode({
			episode: { structural: [], pairs: [] },
			context: {
				labels: { a: 'onboarding', b: 'activation email', c: 'cohort retention' },
				relations: [],
			},
			board: {
				nodeCount: 3,
				nodes: [
					{ id: 'a', text: 'onboarding', hasField: true },
					{ id: 'b', text: 'activation email', hasField: true },
					{ id: 'c', text: 'cohort retention', hasField: false },
				],
				clusters: [{ members: ['a', 'b'] }],
				loners: ['c'],
				proximities: [{ source: 'a', target: 'b', influence: 0.8 }],
				relations: [],
				effectiveStrengths: [],
				truncated: false,
			},
			recentComments: [],
		})

		expect(rendered).toContain('The board as a whole')
		expect(rendered).toContain('"onboarding"')
		expect(rendered).toContain('standing alone')
		expect(rendered).toContain('"cohort retention"')
	})

	// Board ideas are named from the board's own text, so a note the episode never touched
	// (and so absent from the episode labels) is still legible.
	it('names board ideas the episode never touched', () => {
		const rendered = renderEpisode({
			episode: { structural: [], pairs: [] },
			context: { labels: {}, relations: [] },
			board: {
				nodeCount: 2,
				nodes: [
					{ id: 'x', text: 'referral loop', hasField: false },
					{ id: 'y', text: 'trial length', hasField: false },
				],
				clusters: [],
				loners: ['x', 'y'],
				proximities: [],
				relations: [],
				effectiveStrengths: [],
				truncated: false,
			},
			recentComments: [],
		})

		expect(rendered).toContain('"referral loop"')
		expect(rendered).toContain('"trial length"')
		expect(rendered).not.toContain('untitled idea')
	})
})

describe('SYSTEM_PROMPT', () => {
	it('explains the canvas, so influence and gravity are not bare words', () => {
		expect(SYSTEM_PROMPT).toContain('"influence"')
		expect(SYSTEM_PROMPT).toContain('"gravity"')
	})

	it('shows what silence looks like, not only what a good remark looks like', () => {
		// The desired majority outcome had only prose arguing for it and three counter-examples
		// arguing against; an all-positive exemplar list biases toward speaking.
		expect(SYSTEM_PROMPT).toContain('Episodes that warrant silence')
	})
})

describe('interpretDecision', () => {
	it('keeps a spoken remark, trimmed', () => {
		expect(
			interpretDecision(JSON.stringify({ speak: true, comment: '  Those two converged.  ' }))
		).toEqual({
			speak: true,
			comment: 'Those two converged.',
		})
	})

	it('treats speak=true with nothing to say as silence', () => {
		expect(interpretDecision(JSON.stringify({ speak: true, comment: '   ' }))).toEqual(SILENCE)
	})

	it('treats a comment nobody asked for as silence', () => {
		expect(interpretDecision(JSON.stringify({ speak: false, comment: 'unsolicited' }))).toEqual(
			SILENCE
		)
	})

	it('stays silent rather than throwing on unparseable output', () => {
		expect(interpretDecision('not json')).toEqual(SILENCE)
	})

	// Structured output guarantees the JSON is well formed, not that the remark inside it is a
	// remark. With thinking disabled the model's continuation was absorbed into this very
	// field — schema-valid, and up to 1040 characters of it, on its way to the voice.
	it('rejects a remark carrying leaked JSON punctuation', () => {
		const leaked = 'Those two converged.}  Actually: {'
		expect(interpretDecision(JSON.stringify({ speak: true, comment: leaked }))).toEqual(SILENCE)
	})

	it('rejects a remark that leaked the prompt back', () => {
		const leaked = 'Those two converged.Another interaction episode just finished on the canvas.'
		expect(interpretDecision(JSON.stringify({ speak: true, comment: leaked }))).toEqual(SILENCE)
	})

	it('rejects a remark far past any plausible length', () => {
		const runaway = `${'a considered thought. '.repeat(40)}`
		expect(interpretDecision(JSON.stringify({ speak: true, comment: runaway }))).toEqual(SILENCE)
	})

	it('still allows a remark that is merely a little long', () => {
		// The 140-character target is a style rule the eval tracks, not a correctness gate;
		// rejecting on it would throw away good remarks.
		const slightlyLong = 'a'.repeat(180)
		expect(interpretDecision(JSON.stringify({ speak: true, comment: slightlyLong }))).toEqual({
			speak: true,
			comment: slightlyLong,
		})
	})
})

const understanding = {
	themes: [{ name: 'Deal friction', meaning: 'What stalls enterprise deals', members: ['a', 'b'] }],
	reading: 'A board about why deals stall.',
	narrative: 'Started at pricing, kept returning to SSO.',
	tensions: ['Nothing says whether onboarding causes churn or follows it.'],
	derivedFromNodes: ['a', 'b'],
}

describe('renderEpisode with a standing understanding', () => {
	it('states the themes, the reading, the narrative and the tensions', () => {
		const rendered = renderEpisode({ episode: { structural: [], pairs: [] }, understanding })
		expect(rendered).toContain('Deal friction')
		expect(rendered).toContain('A board about why deals stall.')
		expect(rendered).toContain('Started at pricing, kept returning to SSO.')
		expect(rendered).toContain('Nothing says whether onboarding causes churn or follows it.')
	})

	it('says how stale the reading is, so the model can discount it', () => {
		const rendered = renderEpisode({
			episode: { structural: [], pairs: [] },
			understanding,
			driftSince: 8,
		})
		expect(rendered).toMatch(/8 changes ago/)
	})

	it('omits the section entirely when there is no understanding', () => {
		const rendered = renderEpisode({ episode: { structural: [], pairs: [] } })
		expect(rendered).not.toContain('understood this board to be')
	})

	it('places the understanding after the change, so the change stays the subject', () => {
		const rendered = renderEpisode({
			episode: { structural: [{ type: 'node_moved', nodeId: 'a' }], pairs: [] },
			context: { labels: { a: 'pricing is the blocker' }, relations: [] },
			understanding,
		})
		expect(rendered.indexOf('What the user did')).toBeLessThan(rendered.indexOf('Deal friction'))
	})
})

describe('SYSTEM_PROMPT understanding triage', () => {
	it('tells the observer how to judge a change against the standing reading', () => {
		expect(SYSTEM_PROMPT).toContain('FITS')
		expect(SYSTEM_PROMPT).toContain('EXTENDS')
		expect(SYSTEM_PROMPT).toContain('CONTRADICTS')
	})

	it('forbids narrating the understanding back', () => {
		expect(SYSTEM_PROMPT).toContain('never itself a reason to speak')
	})
})
