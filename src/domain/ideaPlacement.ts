/**
 * Where new agent-authored notes go.
 *
 * The reflection proposes note text; a model is poor at coordinates, so — as with a grouping —
 * the client decides positions. New notes drop into open space just to the right of the
 * existing board, stacked in a column, so a fresh idea never lands on the user's work. Pure and
 * deterministic, so the ghost preview and the committed notes sit in the same places.
 */
import type { CanvasNode } from '@/domain/node'
import { POST_IT_DEFAULT_HEIGHT, POST_IT_DEFAULT_WIDTH } from '@/domain/node'
import type { Point } from '@/domain/spatialInfluence'

export interface IdeaPlacementOptions {
	/** Gap between the board and the new column, and between stacked notes. */
	gap?: number
	width?: number
	height?: number
}

export const DEFAULT_IDEA_GAP = 40

/** Axis-aligned bounds of a node, accounting for its rotation. */
function nodeBounds(node: CanvasNode): { maxX: number; minY: number } {
	const { x, y, width, height, rotation } = node.spatial
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	let maxX = -Infinity
	let minY = Infinity
	for (const [dx, dy] of [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	]) {
		maxX = Math.max(maxX, x + dx * cos - dy * sin)
		minY = Math.min(minY, y + dx * sin + dy * cos)
	}
	return { maxX, minY }
}

/** Top-left positions for `count` new notes, in a column beside the existing board. */
export function placeNewNotes(
	existing: CanvasNode[],
	count: number,
	options: IdeaPlacementOptions = {}
): Point[] {
	if (count <= 0) return []

	const gap = options.gap ?? DEFAULT_IDEA_GAP
	const height = options.height ?? POST_IT_DEFAULT_HEIGHT
	// Width is reserved for future layouts (e.g. wrapping columns); the current single column
	// only needs the note height and the board's right edge.
	void (options.width ?? POST_IT_DEFAULT_WIDTH)

	// Anchor the column just past the board's right edge, aligned to its top. An empty board
	// starts the column at the origin.
	let columnX = gap
	let topY = 0
	if (existing.length > 0) {
		const bounds = existing.map(nodeBounds)
		columnX = Math.max(...bounds.map((b) => b.maxX)) + gap
		topY = Math.min(...bounds.map((b) => b.minY))
	}

	const step = height + gap
	return Array.from({ length: count }, (_, index) => ({ x: columnX, y: topY + index * step }))
}
