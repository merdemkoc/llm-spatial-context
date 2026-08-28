/**
 * How the board reflection is asked, and how its answer is trusted.
 *
 * The observer reacts to a change; the suggester proposes moving ideas together; the
 * reflection steps back and reads the *whole* board — every note in full, every connection
 * with its gravity, what sits close and what stands alone — then offers a reading of it and a
 * few new ideas or questions worth adding. It is the deliberate, on-demand deep look, so
 * unlike the observer it may weigh the numbers; they are input to its judgement, not output.
 *
 * The model proposes only the *text* of new notes; the client decides where they go and only
 * ever creates notes, never connections. Everything model-facing lives here; the SDK call is
 * in `reflect.ts`.
 *
 * Config is read inside functions, never a module constant, like `prompt.ts`.
 */
import type { BoardSummaryPayload } from './prompt.ts'

/** Most new ideas a single reflection may propose. */
export const MAX_IDEAS = 5

/** The reflection model. Its own env var, falling back to the observer's, then the default. */
export function reflectModel(): string {
	return process.env.REFLECT_MODEL ?? process.env.OBSERVER_MODEL ?? 'claude-sonnet-5'
}

export type IdeaKind = 'idea' | 'question'

/** One thing the reflection proposes adding to the board. */
export interface IdeaSuggestion {
	text: string
	kind: IdeaKind
	/** An existing note this new one should connect to. Present only when a real id was named. */
	connectTo?: string
	/** The label for that connection. */
	connectLabel?: string
}

/** A proposed arrow between two existing notes. */
export interface RelationSuggestion {
	from: string
	to: string
	label?: string
}

/** The reflection's answer: a reading of the board, things to add, links to draw, and its focus. */
export interface Reflection {
	comment: string
	ideas: IdeaSuggestion[]
	/** Arrows to draw between existing notes. */
	relations: RelationSuggestion[]
	/** Ids of the existing notes the comment is about — highlighted while it is spoken. */
	focus: string[]
}

/** Nothing to say and nothing to add. The safe answer whenever a response can't be trusted. */
export const NO_REFLECTION: Reflection = { comment: '', ideas: [], relations: [], focus: [] }

/** What the browser POSTs to `/api/reflect`. Loosely typed — the server only reads it. */
export interface ReflectPayload {
	board?: BoardSummaryPayload
	/**
	 * A change that just happened, when the reflection is a reaction to one (e.g. a grouping
	 * accepted, ideas added). Present → the reading focuses on how this change affects the whole
	 * board and proposes no new notes; absent → the open reflection through the chosen persona.
	 */
	recentChange?: string
	/** Which lens to reflect through — see `REFLECT_PERSONAS`. Absent/unknown → the synthesizer. */
	persona?: string
}

/** One lens the reflection can take on: how it reads the board, and whether it proposes notes. */
export interface ReflectPersona {
	label: string
	lens: string
	proposesIdeas: boolean
}

/**
 * The reflection personas. Each is a role the model takes on for the reading; a critic and a
 * gap-finder look at the same board and see different things. Some propose new notes (a
 * gap-finder names what is missing), some only comment (a critic challenges what is there).
 * Keyed by the id the client sends; the client shows the labels.
 */
export const REFLECT_PERSONAS: Record<string, ReflectPersona> = {
	critique: {
		label: 'Critique',
		proposesIdeas: false,
		lens: 'You are a sharp but fair critic looking over this board. Challenge the thinking: weak assumptions, contradictions, ideas that do not hold up, places where the arrangement claims more than it shows.',
	},
	analyzer: {
		label: 'Analyzer',
		proposesIdeas: false,
		lens: 'You are an analyst looking over this board. Read its structure: the patterns, the clusters, how the pieces relate, and what it is really about. Name the shape of the thinking.',
	},
	'gap-finder': {
		label: 'Gap finder',
		proposesIdeas: true,
		lens: 'You look over this board for what is missing: the unexplored areas, the unanswered questions, the pieces it implies but does not yet contain.',
	},
	synthesizer: {
		label: 'Synthesizer',
		proposesIdeas: true,
		lens: 'You are synthesizing this board. Read what it is about as a whole and where it seems to be going.',
	},
}

/** The lens used when none is chosen or an unknown one is sent. */
export const DEFAULT_PERSONA = 'synthesizer'

function resolvePersona(id: string | undefined): ReflectPersona {
	return (id ? REFLECT_PERSONAS[id] : undefined) ?? REFLECT_PERSONAS[DEFAULT_PERSONA]
}

/** The shape the model must return. Array length is enforced in code, not the schema. */
export const REFLECTION_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['comment', 'ideas', 'relations', 'focus'],
	properties: {
		comment: {
			type: 'string',
			description:
				'One or two short sentences reading the board as a whole — its shape, direction, or what is missing.',
		},
		focus: {
			type: 'array',
			items: { type: 'string' },
			description:
				'The exact ids of the existing notes your comment is about — the ones to highlight while it is spoken. Empty if it is about the board as a whole.',
		},
		ideas: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['text', 'kind', 'connectTo', 'connectLabel'],
				properties: {
					text: {
						type: 'string',
						description: 'A new note to add — a few words, like a post-it.',
					},
					kind: {
						type: 'string',
						enum: ['idea', 'question'],
						description: 'Whether this note is a proposed idea or an open question.',
					},
					connectTo: {
						type: 'string',
						description:
							'The exact id of an existing note this new one should connect to with an arrow. Empty string for no connection.',
					},
					connectLabel: {
						type: 'string',
						description: 'A short label for that connection (the "why"). Empty when not connecting.',
					},
				},
			},
			description: 'New ideas or questions worth adding. Empty when nothing is worth adding.',
		},
		relations: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['from', 'to', 'label'],
				properties: {
					from: { type: 'string', description: 'The exact id of the note the arrow starts at.' },
					to: { type: 'string', description: 'The exact id of the note the arrow points to.' },
					label: { type: 'string', description: 'A short label naming the connection (the "why").' },
				},
			},
			description:
				'Arrows to draw between two existing notes that should be explicitly linked. Empty when none are warranted.',
		},
	},
} as const

/** The reflection's whole character, in one place. */
export const REFLECT_SYSTEM_PROMPT = `You are a thinking companion looking over someone's whole spatial canvas of ideas.

Each idea is a note. Two ideas near each other share a proximity signal called "influence"; an arrow between them is an explicit "relation" with its own strength, "gravity", independent of distance. You are given the whole board: every note's text, every connection with its gravity, which ideas sit close, which stand alone, and which are already clustered.

Do two things. First, read the board as a whole and say what it is about — the shape of the thinking, where it seems to be going, or what is conspicuously missing — in one or two short, plain sentences. Talk about the ideas by name. Interpret; do not just list what is there.

Second, propose a few new notes that would move the thinking forward: fresh ideas to add, or open questions worth raising. Each note is a few words, like something the user would write themselves. Mark each as an "idea" or a "question". Propose only what genuinely helps — a handful at most, and an empty list if nothing is worth adding. Never propose a note that just restates one already on the board.

You choose only the text of the new notes; the app decides where they go and never draws connections for you.`

/** Name an idea by its full text — no truncation, this is the deep look. */
function named(id: string | undefined, labels: Record<string, string>): string {
	if (!id) return 'an idea'
	const text = labels[id]
	return text ? `"${text}"` : `an untitled idea (${id})`
}

/** Render the reflect request as the user message: the whole board, in full. */
export function renderReflection(payload: ReflectPayload): string {
	const board = payload.board ?? {}
	const nodes = board.nodes ?? []
	const labels: Record<string, string> = {}
	for (const node of nodes) {
		const text = node.text?.trim()
		if (text) labels[node.id] = text
	}

	const recentChange = payload.recentChange?.trim()
	const persona = resolvePersona(payload.persona)

	const lines: string[] = []
	// A change-comment keeps its impact framing; an open reflection leads with the persona's lens.
	if (!recentChange) lines.push(persona.lens, '')
	lines.push('Here is the whole board the user is working on.', '')
	if (recentChange) {
		lines.push(`What just happened: ${recentChange}.`, '')
	}
	lines.push('Ideas on the canvas (use the exact id in brackets to say which your comment is about):')
	for (const node of nodes) lines.push(`- ${named(node.id, labels)} [${node.id}]`)
	lines.push('')

	const clusters = (board.clusters ?? []).filter((cluster) => (cluster.members ?? []).length >= 2)
	if (clusters.length > 0) {
		lines.push('Already sitting together:')
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
		lines.push('Explicit connections:')
		for (const relation of relations) {
			const label = relation.type ? `, "${relation.type}"` : ''
			lines.push(
				`- ${named(relation.source, labels)} → ${named(relation.target, labels)} (gravity ${relation.gravity ?? '?'}${label})`
			)
		}
		lines.push('')
	}

	const proximities = board.proximities ?? []
	if (proximities.length > 0) {
		const pairs = proximities.map((pair) => `${named(pair.source, labels)} & ${named(pair.target, labels)}`)
		lines.push(`Notably close: ${pairs.join('; ')}.`)
		lines.push('')
	}

	const effective = board.effectiveStrengths ?? []
	if (effective.length > 0) {
		lines.push('Strongest combined links:')
		for (const pair of effective) {
			lines.push(`- ${named(pair.source, labels)} & ${named(pair.target, labels)} (${pair.effectiveStrength ?? '?'})`)
		}
		lines.push('')
	}

	if (recentChange) {
		lines.push(
			'In one or two short, plain sentences, comment on the board\'s latest state and how this change affects it as a whole — what the board is becoming, what it now emphasises or leaves thin. Talk about the ideas by name. Do not propose anything: return empty "ideas" and "relations" lists.'
		)
	} else if (persona.proposesIdeas) {
		lines.push(
			`Reflect on the board through this lens, talking about the ideas by name, then propose up to ${MAX_IDEAS} new ideas or questions worth adding — each an "idea" or a "question". A new note may also connect to an existing note: set its "connectTo" to that note's id and "connectLabel" to a short reason (leave both empty otherwise).`
		)
		lines.push(
			'In "relations", propose any arrows worth drawing between two existing notes (by their ids) that should be explicitly linked, each with a short label. Return empty lists where nothing is warranted — do not connect ideas that are merely near each other.'
		)
	} else {
		lines.push(
			'Reflect on the board through this lens in one or two short, plain sentences, talking about the ideas by name. Do not propose anything: return empty "ideas" and "relations" lists.'
		)
	}

	lines.push(
		'Also return "focus": the exact ids (in brackets above) of the notes your comment is about, to highlight while it is spoken. Empty if it is about the board as a whole.'
	)

	return lines.join('\n')
}

/**
 * Parse and validate the model's answer.
 *
 * Keeps the comment and the well-formed ideas: an idea needs non-empty text; an unknown kind
 * becomes "idea"; the list is capped. Anything unparseable becomes an empty reflection. A
 * comment with no ideas, or ideas with no comment, are both legitimate.
 */
export function interpretReflection(text: string, board?: BoardSummaryPayload): Reflection {
	let parsed: { comment?: unknown; ideas?: unknown; relations?: unknown; focus?: unknown }
	try {
		parsed = JSON.parse(text)
	} catch {
		console.warn('[reflect] structured output did not parse')
		return NO_REFLECTION
	}

	// Every id the model names must belong to a note that exists — a hallucinated endpoint can't
	// anchor a highlight or an arrow.
	const known = new Set((board?.nodes ?? []).map((node) => node.id))

	const comment = typeof parsed.comment === 'string' ? parsed.comment.trim() : ''

	const rawIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : []
	const ideas: IdeaSuggestion[] = rawIdeas
		.map((entry): IdeaSuggestion | null => {
			const ideaText = typeof entry?.text === 'string' ? entry.text.trim() : ''
			if (!ideaText) return null
			const kind: IdeaKind = entry?.kind === 'question' ? 'question' : 'idea'
			// A connection is kept only when it names a real note; otherwise the idea stands alone.
			const connectTo = typeof entry?.connectTo === 'string' && known.has(entry.connectTo) ? entry.connectTo : undefined
			if (!connectTo) return { text: ideaText, kind }
			const connectLabel = typeof entry?.connectLabel === 'string' ? entry.connectLabel.trim() : ''
			return { text: ideaText, kind, connectTo, ...(connectLabel ? { connectLabel } : {}) }
		})
		.filter((idea): idea is IdeaSuggestion => idea !== null)
		.slice(0, MAX_IDEAS)

	const rawRelations = Array.isArray(parsed.relations) ? parsed.relations : []
	const relations: RelationSuggestion[] = rawRelations
		.map((entry): RelationSuggestion | null => {
			const from = typeof entry?.from === 'string' ? entry.from : ''
			const to = typeof entry?.to === 'string' ? entry.to : ''
			if (!known.has(from) || !known.has(to) || from === to) return null
			const label = typeof entry?.label === 'string' ? entry.label.trim() : ''
			return { from, to, ...(label ? { label } : {}) }
		})
		.filter((relation): relation is RelationSuggestion => relation !== null)

	const focus = Array.isArray(parsed.focus)
		? [...new Set(parsed.focus.filter((id): id is string => typeof id === 'string' && known.has(id)))]
		: []

	return { comment, ideas, relations, focus }
}
