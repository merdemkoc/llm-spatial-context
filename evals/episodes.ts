/**
 * The corpus the observer is measured against.
 *
 * The product bet is that silence is the normal, correct outcome — and until now nothing
 * checked it. The render tests pin what the model is *shown*; these fixtures pin what it
 * should *decide*. The `silent` cases carry the weight: a companion that speaks too often is
 * the failure mode the prompt is written to avoid, and it is invisible to every other test.
 *
 * Each fixture is an `EpisodePayload` exactly as the browser would POST it. Labels are real
 * sentences rather than lorem, because the observer's whole job is to read meaning from them.
 */
import type { EpisodePayload } from '../server/prompt.ts'

export interface Fixture {
	name: string
	/** What a good observer does with this episode. */
	expect: 'speak' | 'silent'
	/** Why — read this when a case fails and you are deciding who is wrong. */
	note: string
	payload: EpisodePayload
}

const LABELS: Record<string, string> = {
	a: 'pricing is the blocker',
	b: 'SSO keeps coming up in calls',
	c: 'onboarding friction',
	d: 'activation email sequence',
	e: 'enterprise procurement cycle',
	f: 'self-serve trial limits',
}

/** A board these episodes happen on, so the observer always has its surrounding shape. */
const BOARD = {
	nodeCount: 6,
	nodes: [
		{ id: 'a', text: LABELS.a, hasField: true },
		{ id: 'b', text: LABELS.b, hasField: true },
		{ id: 'c', text: LABELS.c, hasField: false },
		{ id: 'd', text: LABELS.d, hasField: false },
		{ id: 'e', text: LABELS.e, hasField: false },
		{ id: 'f', text: LABELS.f, hasField: false },
	],
	clusters: [{ members: ['c', 'd'] }],
	loners: ['e', 'f'],
	proximities: [{ source: 'c', target: 'd', influence: 0.71 }],
	relations: [],
	effectiveStrengths: [{ source: 'c', target: 'd', effectiveStrength: 0.71 }],
	truncated: false,
}

/** The episode context every fixture shares: what the ids mean, and no standing relations. */
const ctx = () => ({ labels: LABELS, relations: [] })

/** One pair moving, with everything else held still. */
function pair(
	source: string,
	target: string,
	before: number,
	after: number,
	transitions: string[] = []
) {
	return {
		source,
		target,
		before: { influence: before },
		after: { influence: after },
		transitions,
	}
}

export const FIXTURES: Fixture[] = [
	// ───────────────────────── silent ─────────────────────────
	{
		name: 'tiny-nudge',
		expect: 'silent',
		note: 'A few pixels. Nothing about the arrangement has changed meaning.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'a' }],
				pairs: [pair('a', 'b', 0.52, 0.54)],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'picked-up-and-put-back',
		expect: 'silent',
		note: 'Moved and returned; influence ends where it started.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'c' }],
				pairs: [pair('c', 'd', 0.71, 0.7)],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'move-with-no-pair-change',
		expect: 'silent',
		note: 'A node moved in empty space — no proximity anywhere was affected.',
		payload: {
			episode: { structural: [{ type: 'node_moved', nodeId: 'e' }], pairs: [] },
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'both-still-out-of-range',
		expect: 'silent',
		note: 'Distance changed but influence stayed at zero: still nothing is in context.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'f' }],
				pairs: [
					{
						source: 'f',
						target: 'e',
						before: { influence: 0, distance: 900 },
						after: { influence: 0, distance: 640 },
						transitions: [],
					},
				],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'already-remarked',
		expect: 'silent',
		note: 'The exact observation is in recentComments. Repeating it is the thing to avoid.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'a' }],
				pairs: [pair('a', 'b', 0.58, 0.63)],
			},
			context: ctx(),
			board: BOARD,
			recentComments: [
				'Pricing and SSO are converging into one concern.',
				'Those two have been drawing together for a while.',
			],
		},
	},
	{
		name: 'unplaced-new-note',
		expect: 'silent',
		note: 'A note created in open space, related to nothing yet.',
		payload: {
			episode: { structural: [{ type: 'node_created', nodeId: 'f' }], pairs: [] },
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'hairline-gravity-change',
		expect: 'silent',
		note: 'A relation strength nudged from 0.80 to 0.82 states nothing new.',
		payload: {
			episode: {
				structural: [
					{
						type: 'relation_gravity_changed',
						source: 'c',
						target: 'd',
						previous: 0.8,
						current: 0.82,
					},
				],
				pairs: [],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'drift-within-cluster',
		expect: 'silent',
		note: 'Two already-clustered ideas shuffle slightly; they were together before and after.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'd' }],
				pairs: [pair('c', 'd', 0.71, 0.66)],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'empty-episode',
		expect: 'silent',
		note: 'Nothing happened at all. A degenerate case that must not produce prose.',
		payload: { episode: { structural: [], pairs: [] }, context: ctx(), board: BOARD },
	},
	{
		name: 'field-radius-tweak',
		expect: 'silent',
		note: 'A context radius adjusted without changing who is in range.',
		payload: {
			episode: {
				structural: [
					{ type: 'contextual_field_changed', nodeId: 'a', previous: 200, current: 210 },
				],
				pairs: [],
			},
			context: ctx(),
			board: BOARD,
		},
	},

	// ───────────────────────── speak ─────────────────────────
	{
		name: 'large-influence-rise',
		expect: 'speak',
		note: 'Two ideas go from unrelated to strongly associated.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'a' }],
				pairs: [pair('a', 'b', 0.04, 0.58, ['proximity_changed:strong'])],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'entered-context',
		expect: 'speak',
		note: "An idea crosses into another's contextual field for the first time.",
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'e' }],
				pairs: [pair('e', 'a', 0, 0.42, ['field_entered'])],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'left-context',
		expect: 'speak',
		note: 'An idea pulled out of range — a separation, which is a statement.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'c' }],
				pairs: [pair('c', 'd', 0.71, 0, ['field_exited'])],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'relation-created',
		expect: 'speak',
		note: 'An explicit connection drawn is the clearest statement the canvas has.',
		payload: {
			episode: {
				structural: [{ type: 'relation_created', source: 'a', target: 'b', gravity: 0.8 }],
				pairs: [],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'relation-deleted',
		expect: 'speak',
		note: 'Removing a connection retracts a claim that was made.',
		payload: {
			episode: {
				structural: [{ type: 'relation_deleted', source: 'c', target: 'd' }],
				pairs: [],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'proximity-relation-divergence',
		expect: 'speak',
		note: 'The arrow survives while the two are pulled apart — the case the prompt names outright.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'a' }],
				pairs: [pair('a', 'b', 0.82, 0.06, ['field_exited'])],
			},
			context: {
				labels: LABELS,
				relations: [{ source: 'a', target: 'b', gravity: 0.9, type: 'blocks' }],
			},
			board: { ...BOARD, relations: [{ source: 'a', target: 'b', gravity: 0.9, type: 'blocks' }] },
		},
	},
	{
		name: 'cluster-forming',
		expect: 'speak',
		note: 'Three ideas converge at once — a theme appearing.',
		payload: {
			episode: {
				structural: [
					{ type: 'node_moved', nodeId: 'e' },
					{ type: 'node_moved', nodeId: 'f' },
				],
				pairs: [
					pair('e', 'f', 0.1, 0.66, ['proximity_changed:strong']),
					pair('e', 'a', 0.05, 0.61, ['proximity_changed:strong']),
					pair('f', 'a', 0.08, 0.59, ['proximity_changed:strong']),
				],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'clustered-idea-deleted',
		expect: 'speak',
		note: 'Removing a member of an established group changes what the group is about.',
		payload: {
			episode: { structural: [{ type: 'node_deleted', nodeId: 'd' }], pairs: [] },
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'bridging-two-groups',
		expect: 'speak',
		note: 'A loner joins two previously separate concerns at once.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'e' }],
				pairs: [
					pair('e', 'c', 0.02, 0.55, ['field_entered']),
					pair('e', 'a', 0.03, 0.51, ['field_entered']),
				],
			},
			context: ctx(),
			board: BOARD,
		},
	},
	{
		name: 'new-remark-despite-history',
		expect: 'speak',
		note: 'History exists but describes something else — the observer should still speak.',
		payload: {
			episode: {
				structural: [{ type: 'relation_created', source: 'e', target: 'f', gravity: 0.7 }],
				pairs: [],
			},
			context: ctx(),
			board: BOARD,
			recentComments: ['Onboarding and activation have settled into one theme.'],
		},
	},
]
