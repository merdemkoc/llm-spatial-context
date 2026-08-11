/**
 * Reading-order labelling.
 *
 * Coordinates are chosen so every expected order is verifiable by hand:
 * post-its are 240×160 by default, so an unrotated node at `y` has its centre
 * at `y + 80`.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type PostItNode } from '@/domain'
import { assignVisualIds } from '@/canvas/grounding/visualId'

const NOW = '2026-08-10T12:00:00.000Z'

interface NodeOptions {
	id: string
	x?: number
	y?: number
	rotation?: number
}

function node({ id, x = 0, y = 0, rotation }: NodeOptions): PostItNode {
	return createPostItNode({ id, x, y, rotation, now: NOW })
}

function labelled(nodes: PostItNode[]): Record<string, string> {
	return Object.fromEntries(assignVisualIds(nodes).map((entry) => [entry.visualId, entry.node.id]))
}

describe('assignVisualIds', () => {
	it('labels nodes N1 upwards, top to bottom', () => {
		const nodes = [
			node({ id: 'middle', y: 500 }),
			node({ id: 'bottom', y: 900 }),
			node({ id: 'top' }),
		]

		expect(labelled(nodes)).toEqual({ N1: 'top', N2: 'middle', N3: 'bottom' })
	})

	it('orders left to right when two nodes share a row', () => {
		const nodes = [node({ id: 'right', x: 400, y: 100 }), node({ id: 'left', x: 0, y: 100 })]

		expect(labelled(nodes)).toEqual({ N1: 'left', N2: 'right' })
	})

	it('falls back to node id when two nodes are exactly coincident', () => {
		const nodes = [node({ id: 'b' }), node({ id: 'a' })]

		expect(labelled(nodes)).toEqual({ N1: 'a', N2: 'b' })
	})

	/**
	 * Both nodes have the same top edge, so anything sorting on `spatial.y`
	 * would tie here and fall through to the id — which would put the rotated
	 * `a` first. The rotated node's centre is genuinely lower on the canvas.
	 */
	it('sorts by the rotation-aware centre rather than the top edge', () => {
		const nodes = [node({ id: 'a', rotation: Math.PI / 2 }), node({ id: 'b' })]

		expect(labelled(nodes)).toEqual({ N1: 'b', N2: 'a' })
	})

	it('returns nothing for an empty canvas', () => {
		expect(assignVisualIds([])).toEqual([])
	})

	it('leaves the caller’s array alone', () => {
		const nodes = [node({ id: 'bottom', y: 900 }), node({ id: 'top' })]

		assignVisualIds(nodes)

		expect(nodes.map((entry) => entry.id)).toEqual(['bottom', 'top'])
	})
})
