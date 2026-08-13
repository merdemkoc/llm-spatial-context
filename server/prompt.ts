/**
 * How the observer is asked, and what it must return.
 *
 * The server owns the prompt so the persona and the interpretation rules can be tuned
 * without shipping anything to the browser — the client only sends the episode. The
 * system prompt is the whole point of MVP-2: read the *meaning* of a spatial change, and
 * stay silent unless it is genuinely worth a word.
 */

/** The reasoning model. A one-line swap (env var) to try Haiku or Opus instead. */
export const OBSERVER_MODEL = process.env.OBSERVER_MODEL ?? 'claude-sonnet-5'

/** The observer's whole character, in one place. */
export const SYSTEM_PROMPT = `You are a quiet thinking companion watching someone arrange ideas on a spatial canvas.

The canvas works like this: each node is an idea. Moving two ideas closer raises a proximity signal called "influence" (0 = far apart or no overlap, 1 = right on top of each other). Drawing an arrow — a "relation" — makes a connection explicit, with its own strength called "gravity" that is independent of distance. Proximity and explicit relations are different statements, and a disagreement between them is information, not a mistake.

Your job is to observe how the arrangement changes and, only when a change genuinely means something, offer one short spoken remark about what it might mean. Interpret the meaning, never recite the numbers: "influence 0.04 → 0.58" means two ideas are becoming strongly associated — say that, not the figure.

Changes usually worth remarking on:
- a large rise or fall in influence between ideas
- ideas entering or leaving one another's context
- several ideas drawing together into a cluster
- an explicit relation created or removed
- a divergence between proximity and an explicit relation (e.g. an arrow kept while the ideas are pulled far apart)

Stay silent when nothing meaningful happened — a small nudge, a stray move. Silence is the normal, correct outcome for most episodes; you are a companion, not a narrator. If you have recently said something similar, stay silent or find something genuinely new to notice.

When you do speak: one or two short, conversational, observational sentences. No preamble, no lists, no questions, no coaching or instructions — just a brief remark, as someone thinking alongside them.

Return the structured decision: speak=true with your remark in "comment", or speak=false with an empty "comment".`

/** The shape the model must return. Kept schema-simple (no nullable types) on purpose. */
export const DECISION_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['speak', 'comment'],
	properties: {
		speak: {
			type: 'boolean',
			description: 'Whether to say the comment aloud. For most episodes this is false.',
		},
		comment: {
			type: 'string',
			description: 'The one- or two-sentence remark. Empty string when staying silent.',
		},
	},
} as const

interface PairSnapshot {
	distance?: number
	influence: number
}

interface EpisodePairChange {
	source: string
	target: string
	before: PairSnapshot
	after: PairSnapshot
}

interface StructuralEventLike {
	type: string
	nodeId?: string
	source?: string
	target?: string
	gravity?: number
	previous?: unknown
	current?: unknown
}

/** What the browser POSTs to `/api/observe`. Loosely typed — the server only reads it. */
export interface EpisodePayload {
	episode: {
		structural: StructuralEventLike[]
		pairs: EpisodePairChange[]
	}
	recentComments: string[]
}

function describeStructural(event: StructuralEventLike): string {
	switch (event.type) {
		case 'relation_created':
			return `explicit relation created ${event.source} → ${event.target} (gravity ${event.gravity?.toFixed(2) ?? '?'})`
		case 'relation_deleted':
			return `explicit relation removed ${event.source} → ${event.target}`
		case 'relation_gravity_changed':
			return `relation strength changed ${String(event.previous)} → ${String(event.current)}`
		case 'relation_rebound':
			return `relation reconnected to different ideas`
		case 'node_created':
			return `new idea ${event.nodeId}`
		case 'node_deleted':
			return `idea removed ${event.nodeId}`
		case 'contextual_field_changed':
			return `idea ${event.nodeId} context radius ${String(event.previous ?? '—')} → ${String(event.current ?? '—')}`
		case 'node_moved':
			return `idea ${event.nodeId} moved`
		default:
			return event.type
	}
}

function describePair(pair: EpisodePairChange): string {
	const distance =
		pair.before.distance !== undefined && pair.after.distance !== undefined
			? ` (distance ${pair.before.distance} → ${pair.after.distance})`
			: ''
	return `${pair.source} → ${pair.target}: influence ${pair.before.influence.toFixed(2)} → ${pair.after.influence.toFixed(2)}${distance}`
}

/** Render one episode as the user message: readable lines the model can interpret. */
export function renderEpisode({ episode, recentComments }: EpisodePayload): string {
	const structural = episode?.structural ?? []
	const pairs = episode?.pairs ?? []
	const lines: string[] = ['An interaction episode just finished on the canvas.', '']

	if (structural.length > 0) {
		lines.push('Structural changes (in order):')
		for (const event of structural) lines.push(`- ${describeStructural(event)}`)
		lines.push('')
	}

	if (pairs.length > 0) {
		lines.push('Proximity influence changes (0 = far apart, 1 = coincident):')
		for (const pair of pairs) lines.push(`- ${describePair(pair)}`)
		lines.push('')
	}

	if (recentComments.length > 0) {
		lines.push('You recently said — vary from these, do not repeat them:')
		for (const comment of recentComments) lines.push(`- "${comment}"`)
		lines.push('')
	}

	lines.push('Decide whether this change is worth a brief spoken remark.')
	return lines.join('\n')
}
