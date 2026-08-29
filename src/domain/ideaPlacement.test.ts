/**
 * Where new agent-authored notes land.
 *
 * The reflection proposes only the text of new notes; this decides their positions — in open
 * space beside the existing board, so a fresh note never drops on top of the user's work.
 * Pure and deterministic, like the cluster layout.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, POST_IT_DEFAULT_HEIGHT, type PostItNode } from '@/domain/node'
import { placeNewNotes } from '@/domain/ideaPlacement'

const NOW = '2026-08-28T12:00:00.000Z'

function node(id: string, x: number, y: number): PostItNode {
	return createPostItNode({ id, x, y, now: NOW })
}

describe('placeNewNotes', () => {
	it('returns no positions for no notes', () => {
		expect(placeNewNotes([node('a', 0, 0)], 0)).toEqual([])
	})

	it('stacks notes in a column when the board is empty', () => {
		const spots = placeNewNotes([], 2)
		expect(spots).toHaveLength(2)
		expect(spots[0].x).toBe(spots[1].x)
		expect(spots[1].y - spots[0].y).toBeGreaterThanOrEqual(POST_IT_DEFAULT_HEIGHT)
	})

	it('places new notes clear to the right of the existing board', () => {
		const existing = [node('a', 0, 0), node('b', 300, 0)]
		const rightEdge = 300 + 240 // b's right edge

		const spots = placeNewNotes(existing, 3)

		for (const spot of spots) expect(spot.x).toBeGreaterThanOrEqual(rightEdge)
	})

	it('is deterministic', () => {
		const existing = [node('a', 0, 0), node('b', 300, 200)]
		expect(placeNewNotes(existing, 3)).toEqual(placeNewNotes(existing, 3))
	})
})
