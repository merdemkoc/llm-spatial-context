/**
 * How the observer is asked, and what it must return.
 *
 * The server owns the prompt so the persona and the interpretation rules can be tuned
 * without shipping anything to the browser — the client only sends the episode. The
 * system prompt is the whole point of MVP-2: read the *meaning* of a spatial change, and
 * stay silent unless it is genuinely worth a word.
 *
 * Config is read inside functions, never captured in a module constant. `index.ts` calls
 * `process.loadEnvFile()` in its own body, but ESM evaluates this module first, so a
 * constant here would bake the default and silently ignore `.env`.
 */

/** The reasoning model. A one-line swap (env var) to try another. */
export function observerModel(): string {
	return process.env.OBSERVER_MODEL ?? 'claude-sonnet-5'
}

/** The observer's whole character, in one place. */
export const SYSTEM_PROMPT = `You are a quiet thinking companion watching someone arrange ideas on a spatial canvas.

The canvas works like this: each node is an idea, written on a note. Moving two ideas closer raises a proximity signal called "influence" (0 = far apart or out of range, 1 = right on top of each other). Drawing an arrow — a "relation" — makes a connection explicit, with its own strength called "gravity" that is independent of distance. Proximity and explicit relations are different statements, and a disagreement between them is information, not a mistake.

Your job is to observe how the arrangement changes and, only when a change genuinely means something, offer one short spoken remark about what it might mean. Talk about the ideas by name, using the note text you are given. Interpret the meaning, never recite the numbers: an influence rising from 0.04 to 0.58 means two ideas are becoming strongly associated — say that, not the figure.

Changes usually worth remarking on:
- a large rise or fall in influence between ideas
- ideas entering or leaving one another's context
- several ideas drawing together into a cluster
- an explicit relation created or removed
- a divergence between proximity and an explicit relation (for example an arrow that still exists while the two ideas are pulled far apart)

Stay silent when nothing meaningful happened — a small nudge, a stray move, or a change you have already remarked on. Silence is the normal, correct outcome for most episodes; you are a companion, not a narrator. If you have recently said something similar, either stay silent or notice something genuinely new.

When you do speak: one sentence, or two at the most, and keep it under about 140 characters. Say what the arrangement now means, not what the user did to it — the move is the input you were handed, not the observation. Shorter is better.

Remarks pitched right:
- "So pricing might not be the blocker at all — it's SSO underneath it."
- "Those three have settled into what looks like a single theme."
- "You've kept the connection while pulling them apart, which is its own statement."

No preamble, no lists, no questions, no coaching or instructions — just a brief remark, as someone thinking alongside them.

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
	transitions?: string[]
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

interface RelationContext {
	source: string
	target: string
	gravity: number
	type?: string
}

/** What the browser POSTs to `/api/observe`. Loosely typed — the server only reads it. */
export interface EpisodePayload {
	episode?: {
		structural?: StructuralEventLike[]
		pairs?: EpisodePairChange[]
	}
	context?: {
		labels?: Record<string, string>
		relations?: RelationContext[]
	}
	recentComments?: string[]
}

/**
 * How an id is written for the model.
 *
 * A bare `NodeId` is a tldraw shape id — `shape:V1StGXR8` — which tells the model nothing
 * about the idea. With the note text available, lead with the text and keep the id only as
 * a disambiguator for notes that read alike.
 */
function name(id: string | undefined, labels: Record<string, string>): string {
	if (!id) return 'an idea'
	const text = labels[id]?.trim()
	if (!text) return `an untitled idea (${id})`
	const short = text.length > 60 ? `${text.slice(0, 57)}...` : text
	return `"${short}"`
}

const TRANSITION_PROSE: Record<string, string> = {
	field_entered: 'entered its context',
	field_exited: 'left its context',
	influence_changed: 'shifted while in context',
	'proximity_changed:strong': 'crossed into strong proximity',
	'proximity_changed:weak': 'dropped to weak proximity',
}

function describeStructural(event: StructuralEventLike, labels: Record<string, string>): string {
	const who = name(event.nodeId, labels)
	switch (event.type) {
		case 'relation_created':
			return `explicit relation drawn: ${name(event.source, labels)} to ${name(event.target, labels)} (gravity ${event.gravity?.toFixed(2) ?? '?'})`
		case 'relation_deleted':
			return `explicit relation removed: ${name(event.source, labels)} to ${name(event.target, labels)}`
		case 'relation_gravity_changed':
			return `relation strength changed from ${String(event.previous)} to ${String(event.current)}`
		case 'relation_rebound':
			return 'a relation was reconnected to different ideas'
		case 'node_created':
			return `new idea added: ${who}`
		case 'node_deleted':
			return `idea removed: ${who}`
		case 'contextual_field_changed':
			return `${who} changed its context radius from ${String(event.previous ?? 'none')} to ${String(event.current ?? 'none')}`
		case 'node_moved':
			return `${who} was moved`
		default:
			return event.type
	}
}

function describePair(pair: EpisodePairChange, labels: Record<string, string>): string {
	const distance =
		pair.before.distance !== undefined && pair.after.distance !== undefined
			? `, distance ${pair.before.distance} to ${pair.after.distance}`
			: ''
	const transitions = (pair.transitions ?? [])
		.map((transition) => TRANSITION_PROSE[transition] ?? transition)
		.join(', ')
	const summary = transitions === '' ? '' : ` — ${transitions}`
	return `${name(pair.source, labels)} toward ${name(pair.target, labels)}: influence ${pair.before.influence.toFixed(2)} to ${pair.after.influence.toFixed(2)}${distance}${summary}`
}

/** Render one episode as the user message: readable lines the model can interpret. */
export function renderEpisode(payload: EpisodePayload): string {
	const structural = payload.episode?.structural ?? []
	const pairs = payload.episode?.pairs ?? []
	const labels = payload.context?.labels ?? {}
	const relations = payload.context?.relations ?? []
	const recentComments = payload.recentComments ?? []

	const lines: string[] = ['An interaction episode just finished on the canvas.', '']

	if (structural.length > 0) {
		lines.push('What the user did:')
		for (const event of structural) lines.push(`- ${describeStructural(event, labels)}`)
		lines.push('')
	}

	if (pairs.length > 0) {
		lines.push('How proximity changed (influence 0 = out of range, 1 = coincident):')
		for (const pair of pairs) lines.push(`- ${describePair(pair, labels)}`)
		lines.push('')
	}

	// Standing relations, not just ones this episode touched: an arrow drawn long ago is
	// what makes "pulled apart but still connected" legible at all.
	if (relations.length > 0) {
		lines.push('Explicit relations that currently exist:')
		for (const relation of relations) {
			const label = relation.type ? ` labelled "${relation.type}"` : ''
			lines.push(
				`- ${name(relation.source, labels)} to ${name(relation.target, labels)}${label} (gravity ${relation.gravity.toFixed(2)})`
			)
		}
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
