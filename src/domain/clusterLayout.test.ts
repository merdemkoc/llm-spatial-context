/**
 * The geometry of a grouping.
 *
 * The model chooses *which* ideas belong together; this decides *where* they go —
 * a tidy cluster pulled to the members' shared centre, packed without overlap and
 * slid clear of everything it is not grouping. Pure and deterministic, so the
 * ghost preview and the applied move are always the same arrangement.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type PostItNode } from '@/domain/node'
import { nodeCenter } from '@/domain/spatialInfluence'
import { computeClusterLayout, type ClusterPlacement } from '@/domain/clusterLayout'

const NOW = '2026-08-28T12:00:00.000Z'

interface NodeOptions {
	id: string
	x?: number
	y?: number
	rotation?: number
}

function node({ id, x = 0, y = 0, rotation }: NodeOptions): PostItNode {
	return createPostItNode({ id, x, y, rotation, now: NOW })
}

/** The axis-aligned bounds of a placed node, from its (possibly rotated) corners. */
function placedBounds(placement: ClusterPlacement, source: PostItNode) {
	const { width, height, rotation } = source.spatial
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	const corners = [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	].map(([dx, dy]) => ({
		x: placement.x + dx * cos - dy * sin,
		y: placement.y + dx * sin + dy * cos,
	}))
	const xs = corners.map((c) => c.x)
	const ys = corners.map((c) => c.y)
	return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function overlaps(a: ReturnType<typeof placedBounds>, b: ReturnType<typeof placedBounds>): boolean {
	return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function maxPairwiseCenterDistance(nodes: { spatial: PostItNode['spatial'] }[]): number {
	let max = 0
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const a = nodeCenter(nodes[i] as PostItNode)
			const b = nodeCenter(nodes[j] as PostItNode)
			max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y))
		}
	}
	return max
}

function place(placement: ClusterPlacement, source: PostItNode): PostItNode {
	return { ...source, spatial: { ...source.spatial, x: placement.x, y: placement.y } }
}

describe('computeClusterLayout', () => {
	it('returns nothing for no members', () => {
		expect(computeClusterLayout([], [])).toEqual([])
	})

	it('leaves a single member where it is', () => {
		const only = node({ id: 'a', x: 300, y: 200 })
		expect(computeClusterLayout([only], [])).toEqual([{ id: 'a', x: 300, y: 200 }])
	})

	it('pulls scattered members closer together', () => {
		const members = [
			node({ id: 'a', x: 0, y: 0 }),
			node({ id: 'b', x: 1000, y: 0 }),
			node({ id: 'c', x: 0, y: 1000 }),
		]
		const before = maxPairwiseCenterDistance(members)

		const placements = computeClusterLayout(members, [])
		const after = maxPairwiseCenterDistance(
			placements.map((p) => place(p, members.find((m) => m.id === p.id)!))
		)

		expect(after).toBeLessThan(before)
	})

	it('packs members without overlapping one another', () => {
		const members = [
			node({ id: 'a', x: 0, y: 0 }),
			node({ id: 'b', x: 900, y: 0 }),
			node({ id: 'c', x: 0, y: 900 }),
			node({ id: 'd', x: 900, y: 900 }),
		]
		const placements = computeClusterLayout(members, [])

		for (let i = 0; i < placements.length; i++) {
			for (let j = i + 1; j < placements.length; j++) {
				const a = placedBounds(placements[i], members.find((m) => m.id === placements[i].id)!)
				const b = placedBounds(placements[j], members.find((m) => m.id === placements[j].id)!)
				expect(overlaps(a, b)).toBe(false)
			}
		}
	})

	it('slides the cluster clear of a non-member sitting where it would land', () => {
		const members = [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 300, y: 0 })]
		// An obstacle straddling the centroid, where the packed grid would otherwise sit.
		const obstacle = node({ id: 'o', x: 200, y: 0 })

		const placements = computeClusterLayout(members, [obstacle])
		const obstacleBounds = placedBounds({ id: 'o', x: obstacle.spatial.x, y: obstacle.spatial.y }, obstacle)

		for (const placement of placements) {
			const bounds = placedBounds(placement, members.find((m) => m.id === placement.id)!)
			expect(overlaps(bounds, obstacleBounds)).toBe(false)
		}
	})

	it('is deterministic', () => {
		const members = [
			node({ id: 'a', x: 0, y: 0 }),
			node({ id: 'b', x: 1000, y: 400 }),
			node({ id: 'c', x: 500, y: 900 }),
		]
		expect(computeClusterLayout(members, [])).toEqual(computeClusterLayout(members, []))
	})

	it('centres a rotated member correctly on the grid', () => {
		// Two members side by side, one turned a quarter-turn. If the top-left → centre
		// conversion ignored rotation, the turned note's recovered centre would drift off
		// the grid row instead of sitting exactly a cell-width from its neighbour.
		const upright = node({ id: 'a', x: 0, y: 0 })
		const turned = node({ id: 'b', x: 40, y: 0, rotation: Math.PI / 2 })

		const placements = computeClusterLayout([upright, turned], [])
		const centers = placements.map((p) =>
			nodeCenter(place(p, [upright, turned].find((m) => m.id === p.id)!))
		)

		expect(centers[0].y).toBeCloseTo(centers[1].y)
		expect(Math.abs(centers[0].x - centers[1].x)).toBeGreaterThan(0)
	})
})
