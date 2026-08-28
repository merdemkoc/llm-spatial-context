/**
 * How the suggester is asked, and how its answer is trusted.
 *
 * The observer reads a change and reacts; the suggester reads the whole board and,
 * when a scattered-but-related set stands out, proposes pulling it together. It picks
 * *which ideas* — never where they go, because a model is poor at coordinates and the
 * client arranges them itself — so the prompt shows every idea's id and asks for those
 * ids back.
 *
 * Two rules carry the persona across from the observer: it proposes only moving ideas
 * nearer each other (never an arrow, never new content), and declining is the common,
 * correct answer. Everything model-facing lives here; the SDK call is in `suggest.ts`.
 *
 * Config is read inside functions, never a module constant, for the same reason as
 * `prompt.ts`: ESM evaluates this before `index.ts` loads `.env`.
 */
import type { BoardSummaryPayload } from './prompt.ts'

/** The suggester model. Its own env var, falling back to the observer's, then the default. */
export function suggesterModel(): string {
	return process.env.SUGGESTER_MODEL ?? process.env.OBSERVER_MODEL ?? 'claude-sonnet-5'
}

/** The suggester's whole character, in one place. */
export const SUGGEST_SYSTEM_PROMPT = `You are the quiet thinking companion for a spatial idea canvas. Now and then you notice that several scattered ideas clearly belong together and could be pulled into one cluster.

Each idea is a note with text; you are given the whole board, its existing clusters, the ideas standing alone, and the explicit relations the user drew. You choose the MEMBERS — which ideas belong together — and say in one short line why. You never decide where they go; the app arranges them. You never invent a connection: this only ever suggests moving ideas nearer each other, never drawing an arrow or adding anything new.

Suggest a grouping only when it is genuinely warranted: the ideas share a clear theme or an explicit relation, and they are currently apart rather than already clustered. Never propose a set that is already sitting together. When nothing clearly warrants it, return suggest=false — that is the common, correct answer. Keep the rationale to one short, plain sentence that names the theme; do not instruct or coach.

Return the structured decision: suggest=true with two or more member ids and a one-sentence "comment", or suggest=false with no members and an empty comment.`

/** The shape the model must return. Kept schema-simple; array length is enforced in code. */
export const GROUPING_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['suggest', 'members', 'comment'],
	properties: {
		suggest: {
			type: 'boolean',
			description:
				'Whether a grouping is warranted. Usually false, unless a clearly scattered, strongly related set stands out.',
		},
		members: {
			type: 'array',
			items: { type: 'string' },
			description:
				'The exact ids of the ideas that belong together. Empty when not suggesting; at least two when suggesting.',
		},
		comment: {
			type: 'string',
			description: 'One short sentence naming what unites the ideas. Empty when not suggesting.',
		},
	},
} as const

/** What the browser POSTs to `/api/suggest`. Loosely typed — the server only reads it. */
export interface SuggestPayload {
	board?: BoardSummaryPayload
	trigger?: 'demand' | 'proactive'
	recentComments?: string[]
}

/** The suggester's verdict, after validation. */
export interface GroupingSuggestion {
	suggest: boolean
	members: string[]
	comment: string
}

/** Decline. The one safe answer whenever a response can't be trusted. */
export const NO_GROUPING: GroupingSuggestion = { suggest: false, members: [], comment: '' }

/** Name an idea by its text, keeping the id available for the model to echo. */
function named(id: string | undefined, labels: Record<string, string>): string {
	if (!id) return 'an idea'
	const text = labels[id]
	if (!text) return `an untitled idea (${id})`
	const short = text.length > 60 ? `${text.slice(0, 57)}...` : text
	return `"${short}"`
}

/** Render the suggest request as the user message: the whole board, ids and all. */
export function renderSuggestRequest(payload: SuggestPayload): string {
	const board = payload.board ?? {}
	const nodes = board.nodes ?? []
	const labels: Record<string, string> = {}
	for (const node of nodes) {
		const text = node.text?.trim()
		if (text) labels[node.id] = text
	}

	const lines: string[] = [
		'The user is arranging ideas on a spatial canvas. Here is the whole board.',
		'',
		'Ideas (use the exact id in brackets when you name members):',
	]
	for (const node of nodes) {
		const text = labels[node.id]
		const shown = text ? named(node.id, labels) : 'an untitled idea'
		lines.push(`- ${shown} [${node.id}]`)
	}
	lines.push('')

	const clusters = (board.clusters ?? []).filter((cluster) => (cluster.members ?? []).length >= 2)
	if (clusters.length > 0) {
		lines.push('Already sitting together (do not re-propose these):')
		for (const cluster of clusters) {
			lines.push(`- ${(cluster.members ?? []).map((id) => named(id, labels)).join(', ')}`)
		}
		lines.push('')
	}

	const loners = board.loners ?? []
	if (loners.length > 0) {
		lines.push(`Ideas standing alone: ${loners.map((id) => named(id, labels)).join(', ')}`)
		lines.push('')
	}

	const relations = board.relations ?? []
	if (relations.length > 0) {
		lines.push('Explicit relations the user drew:')
		for (const relation of relations) {
			const label = relation.type ? ` ("${relation.type}")` : ''
			lines.push(`- ${named(relation.source, labels)} → ${named(relation.target, labels)}${label}`)
		}
		lines.push('')
	}

	if ((payload.recentComments ?? []).length > 0) {
		lines.push('You recently said — do not simply repeat these:')
		for (const comment of payload.recentComments!) lines.push(`- "${comment}"`)
		lines.push('')
	}

	lines.push(
		'Propose at most one grouping: a set of two or more ideas that clearly belong together — related by meaning or by an explicit relation — but are currently scattered rather than already close. Return their exact ids in "members" and one short sentence in "comment" naming what unites them.'
	)
	if (payload.trigger === 'proactive') {
		lines.push(
			'This is unprompted, so only propose if the case is strong; otherwise return suggest=false.'
		)
	}
	lines.push(
		'If no grouping is clearly warranted, return suggest=false with no members and an empty comment.'
	)

	return lines.join('\n')
}

/**
 * Parse and validate the model's answer.
 *
 * Structured output guarantees the three fields exist but not that `members` holds two
 * or more ids that are actually on the board — so that is enforced here. Unknown ids are
 * dropped, duplicates collapsed, and anything short of two survivors with a rationale
 * becomes a decline. A model that hallucinates or names one idea proposes nothing.
 */
export function interpretGrouping(text: string, board?: BoardSummaryPayload): GroupingSuggestion {
	let parsed: { suggest?: unknown; members?: unknown; comment?: unknown }
	try {
		parsed = JSON.parse(text)
	} catch {
		console.warn('[suggest] structured output did not parse')
		return NO_GROUPING
	}

	const known = new Set((board?.nodes ?? []).map((node) => node.id))
	const members = Array.isArray(parsed.members)
		? [...new Set(parsed.members.filter((id): id is string => typeof id === 'string' && known.has(id)))]
		: []
	const comment = typeof parsed.comment === 'string' ? parsed.comment.trim() : ''

	return parsed.suggest === true && members.length >= 2 && comment !== ''
		? { suggest: true, members, comment }
		: NO_GROUPING
}
