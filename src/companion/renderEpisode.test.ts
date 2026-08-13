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
import { renderEpisode } from '../../server/prompt.ts'

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
})
