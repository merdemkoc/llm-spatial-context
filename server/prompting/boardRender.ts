/**
 * How a board is written for a model, in one place.
 *
 * Three agents render the same board and used to do it with three near-identical private
 * helpers. The mechanics — resolving an id to its note text, filtering clusters worth
 * naming, joining pairs — are genuinely shared and live here. The prose is not: each agent
 * keeps its own headings, because a suggester told "do not re-propose these" and a
 * reflection told "already sitting together" are asking for different things.
 *
 * The observer is deliberately NOT a caller of `renderBoardBlocks`. Its board is an inline
 * bulleted aside under a heading — context, not the subject — where the other two use
 * standalone headed blocks. Forcing one function to emit both shapes needs a knob for every
 * line it writes, which is worse than the duplication it removes. It shares `named` and
 * `renderRecentComments` and renders its own sections.
 */
import type { BoardSummaryPayload } from './types.ts'

/**
 * Name an idea by its note text.
 *
 * A bare id is a tldraw shape id — `shape:V1StGXR8` — which tells the model nothing about
 * the idea. Lead with the text and keep the id only as a disambiguator for notes that read
 * alike. `maxLength` truncates for the observer, whose board is background; the suggester
 * and the reflection read every note in full, because their answer is only as good as their
 * grasp of what each note actually says.
 */
export function named(
	id: string | undefined,
	labels: Record<string, string>,
	options: { maxLength?: number } = {}
): string {
	if (!id) return 'an idea'
	const text = labels[id]?.trim()
	if (!text) return `an untitled idea (${id})`
	const { maxLength } = options
	if (maxLength !== undefined && text.length > maxLength) {
		return `"${text.slice(0, maxLength - 3)}..."`
	}
	return `"${text}"`
}

/** Name several ideas as one comma-joined run. */
export function namedList(
	ids: (string | undefined)[],
	labels: Record<string, string>,
	options: { maxLength?: number } = {}
): string {
	return ids.map((id) => named(id, labels, options)).join(', ')
}

/** Clusters worth naming: a group of one is not a group. */
export function realClusters(board: BoardSummaryPayload): { members?: string[] }[] {
	return (board.clusters ?? []).filter((cluster) => (cluster.members ?? []).length >= 2)
}

/** Name each notably-close pair, joined for one line. */
export function proximityPairs(
	board: BoardSummaryPayload,
	labels: Record<string, string>,
	options: { maxLength?: number } = {}
): string {
	return (board.proximities ?? [])
		.map(
			(pair) => `${named(pair.source, labels, options)} & ${named(pair.target, labels, options)}`
		)
		.join('; ')
}

/** The headings that differ between the two block-format agents. */
export interface BoardBlockOptions {
	clusterHeading: string
	relationHeading: string
	/** The reflection states each arrow's gravity; the suggester does not read it. */
	relationGravity: boolean
	proximityHeading: string
	/** Present only for the reflection, the one agent given the combined signal. */
	effectiveHeading?: string
}

/**
 * The whole board as standalone headed blocks, in the order both callers use: what already
 * sits together, what stands alone, what is explicitly connected, what is merely close, and
 * (for the reflection) where the two signals combine most strongly.
 *
 * Every block ends with a blank line, so a caller can concatenate without tracking spacing.
 */
export function renderBoardBlocks(
	board: BoardSummaryPayload,
	labels: Record<string, string>,
	options: BoardBlockOptions
): string[] {
	const lines: string[] = []

	const clusters = realClusters(board)
	if (clusters.length > 0) {
		lines.push(options.clusterHeading)
		for (const cluster of clusters) lines.push(`- ${namedList(cluster.members ?? [], labels)}`)
		lines.push('')
	}

	const loners = board.loners ?? []
	if (loners.length > 0) {
		lines.push(`Ideas standing alone: ${namedList(loners, labels)}`)
		lines.push('')
	}

	const relations = board.relations ?? []
	if (relations.length > 0) {
		lines.push(options.relationHeading)
		for (const relation of relations) {
			// Gravity and the label interleave differently: with gravity the label joins it
			// inside one parenthesis, without it the label stands alone in its own.
			const suffix = options.relationGravity
				? ` (gravity ${relation.gravity ?? '?'}${relation.type ? `, "${relation.type}"` : ''})`
				: relation.type
					? ` ("${relation.type}")`
					: ''
			lines.push(`- ${named(relation.source, labels)} → ${named(relation.target, labels)}${suffix}`)
		}
		lines.push('')
	}

	if ((board.proximities ?? []).length > 0) {
		lines.push(`${options.proximityHeading} ${proximityPairs(board, labels)}.`)
		lines.push('')
	}

	const effective = board.effectiveStrengths ?? []
	if (options.effectiveHeading !== undefined && effective.length > 0) {
		lines.push(options.effectiveHeading)
		for (const pair of effective) {
			lines.push(
				`- ${named(pair.source, labels)} & ${named(pair.target, labels)} (${pair.effectiveStrength ?? '?'})`
			)
		}
		lines.push('')
	}

	return lines
}

/**
 * What the agent recently said, so it can vary from itself.
 *
 * The heading carries each agent's own emphasis; the block below it is the same everywhere.
 */
export function renderRecentComments(comments: string[], heading: string): string[] {
	if (comments.length === 0) return []
	return [heading, ...comments.map((comment) => `- "${comment}"`), '']
}

/** Build the id → note text map a board's own nodes imply. */
export function boardLabels(board: BoardSummaryPayload): Record<string, string> {
	const labels: Record<string, string> = {}
	for (const node of board.nodes ?? []) {
		const text = node.text?.trim()
		if (text) labels[node.id] = text
	}
	return labels
}
