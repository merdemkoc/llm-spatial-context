/**
 * How the digest is asked, and how its answer is trusted.
 *
 * The observer reacts to a change, the suggester proposes a grouping, the reflection speaks a
 * reading to the user. The digest speaks to nobody: it reads the whole board and produces the
 * standing understanding the other three are given as context.
 *
 * That makes it the one agent whose mistakes compound. A hallucinated theme does not embarrass
 * a single remark — it is stored, and it colours every remark until the next derivation. So it
 * validates harder than its siblings: themes must name notes that exist, a theme of one is not
 * a theme, and any free text that reads as spillage is dropped rather than kept.
 *
 * Config is read inside functions, never a module constant, like `prompt.ts`.
 */
import {
	boardLabels,
	named,
	renderBoardBlocks,
	renderRecentComments,
} from './prompting/boardRender.ts'
import { CANVAS_PRIMER } from './prompting/fragments.ts'
import { isCleanRemark } from './prompting/remark.ts'
import type { BoardSummaryPayload, BoardUnderstanding, Theme } from './prompting/types.ts'

export type { BoardUnderstanding, Theme } from './prompting/types.ts'

/** Most themes one reading may name. Past this it is a list, not an understanding. */
export const MAX_THEMES = 5

/** Most open tensions one reading may name. */
export const MAX_TENSIONS = 3

/** The digest model. Its own env var, falling back to the observer's, then the default. */
export function digestModel(): string {
	return process.env.DIGEST_MODEL ?? process.env.OBSERVER_MODEL ?? 'claude-sonnet-5'
}

/** Nothing understood. The safe answer whenever a response can't be trusted. */
export const NO_UNDERSTANDING: BoardUnderstanding = {
	themes: [],
	reading: '',
	narrative: '',
	tensions: [],
	derivedFromNodes: [],
}

/** What the browser POSTs to `/api/digest`. Loosely typed — the server only reads it. */
export interface DigestPayload {
	board?: BoardSummaryPayload
	/** What the companion has said this session, so the narrative is the arc and not the snapshot. */
	recentComments?: string[]
}

/** The digest's whole character, in one place. */
export const DIGEST_SYSTEM_PROMPT = `You are the memory of a thinking companion that watches someone arrange ideas on a spatial canvas.

${CANVAS_PRIMER}

You are not speaking to the user. Nothing you write is read aloud. Your job is to produce the companion's standing understanding of this board, which its other voices are given as background before they decide what to say. Write for them, not for the person at the canvas.

Produce four things:

- THEMES: the two to five groupings this board is actually organised around. Name each in a few words, say in one line what it means, and list the exact ids of the notes in it. A theme needs at least two notes. Group by what the ideas are about, not merely by what sits close — proximity is evidence, not the answer.
- READING: what this board is about as a whole, in one or two plain sentences.
- NARRATIVE: what the session has been circling, judged from what the companion has recently said. Where the thinking started, where it has gone, what it keeps returning to. If there is no history to read, leave this empty rather than inventing an arc.
- TENSIONS: up to three things the board leaves unresolved — a contradiction, a gap, something asserted but unsupported. Leave this empty rather than manufacturing doubt.

Name ideas by their text. Be concrete and specific to this board: a reading that would fit any board is worth nothing. Use the exact ids given in brackets when you list a theme's members.`

/** The shape the model must return. Array lengths are enforced in code, not the schema. */
export const DIGEST_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['themes', 'reading', 'narrative', 'tensions'],
	properties: {
		themes: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'meaning', 'members'],
				properties: {
					name: { type: 'string', description: 'A few words naming the theme.' },
					meaning: { type: 'string', description: 'One line on what unites these ideas.' },
					members: {
						type: 'array',
						items: { type: 'string' },
						description: 'The exact ids of the notes in this theme. At least two.',
					},
				},
			},
			description: 'The groupings this board is organised around. Empty if none are clear.',
		},
		reading: {
			type: 'string',
			description: 'What this board is about as a whole, in one or two plain sentences.',
		},
		narrative: {
			type: 'string',
			description: 'What the session has been circling. Empty when there is no history to read.',
		},
		tensions: {
			type: 'array',
			items: { type: 'string' },
			description: 'What the board leaves unresolved. Empty when nothing clearly does.',
		},
	},
} as const

/** Render the digest request as the user message: the whole board, plus what has been said. */
export function renderDigestRequest(payload: DigestPayload): string {
	const board = payload.board ?? {}
	const nodes = board.nodes ?? []
	const labels = boardLabels(board)

	const lines: string[] = [
		'Here is the whole board, to be read as a standing understanding.',
		'',
		"Ideas on the canvas (use the exact id in brackets when you list a theme's members):",
	]
	for (const node of nodes) lines.push(`- ${named(node.id, labels)} [${node.id}]`)
	lines.push('')

	for (const line of renderBoardBlocks(board, labels, {
		clusterHeading: 'Already sitting together:',
		relationHeading: 'Explicit connections:',
		relationGravity: true,
		proximityHeading: 'Notably close:',
		effectiveHeading: 'Strongest combined links:',
	})) {
		lines.push(line)
	}

	for (const line of renderRecentComments(
		payload.recentComments ?? [],
		'What the companion has said this session, in order — read the arc from it:'
	)) {
		lines.push(line)
	}

	lines.push(
		'Return the themes, the reading, the narrative and the tensions. Leave a field empty rather than filling it with something that would fit any board.'
	)
	return lines.join('\n')
}

/** Keep a free-text field only if it reads as prose rather than as spillage. */
function cleanText(value: unknown): string {
	const text = typeof value === 'string' ? value.trim() : ''
	return text !== '' && isCleanRemark(text) ? text : ''
}

/**
 * Parse and validate the model's answer.
 *
 * Structured output guarantees the four fields exist. It does not guarantee that a theme names
 * real notes, that a theme has more than one member, or that the prose is prose. All three are
 * enforced here, because this answer is stored and reused rather than spoken once.
 */
export function interpretUnderstanding(
	text: string,
	board?: BoardSummaryPayload
): BoardUnderstanding {
	let parsed: { themes?: unknown; reading?: unknown; narrative?: unknown; tensions?: unknown }
	try {
		parsed = JSON.parse(text)
	} catch {
		console.warn('[digest] structured output did not parse')
		return NO_UNDERSTANDING
	}

	const known = new Set((board?.nodes ?? []).map((node) => node.id))

	const rawThemes = Array.isArray(parsed.themes) ? parsed.themes : []
	const themes: Theme[] = rawThemes
		.map((entry): Theme | null => {
			const name = cleanText(entry?.name)
			const meaning = cleanText(entry?.meaning)
			if (name === '') return null
			const rawMembers: unknown = entry?.members
			const members = Array.isArray(rawMembers)
				? [
						...new Set(
							rawMembers.filter(
								(id: unknown): id is string => typeof id === 'string' && known.has(id)
							)
						),
					]
				: []
			// A theme of one is not a theme, and a theme of nobody is a hallucination.
			return members.length >= 2 ? { name, meaning, members } : null
		})
		.filter((theme): theme is Theme => theme !== null)
		.slice(0, MAX_THEMES)

	const tensions = (Array.isArray(parsed.tensions) ? parsed.tensions : [])
		.map(cleanText)
		.filter((tension: string) => tension !== '')
		.slice(0, MAX_TENSIONS)

	return {
		themes,
		reading: cleanText(parsed.reading),
		narrative: cleanText(parsed.narrative),
		tensions,
		derivedFromNodes: [...known],
	}
}
