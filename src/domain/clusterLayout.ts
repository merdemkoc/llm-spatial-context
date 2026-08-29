/**
 * Where a grouping's members go.
 *
 * The suggester decides *which* ideas belong together; a language model is poor at
 * coordinates, so it never proposes positions. This does — deterministically, from
 * the members' own geometry — which is the other half of "the model picks members,
 * the client computes positions".
 *
 * The arrangement: pull the members to their shared centre and pack them into a
 * tidy grid, sized so no two overlap however they are rotated, then slide the whole
 * block clear of anything it is not grouping. The block stays rigid while it slides,
 * so the tidy grid survives the avoidance step.
 *
 * A grouping only ever moves notes — it never draws an arrow or invents an entity —
 * so this returns new top-left positions and nothing else. Pure, no tldraw.
 */
import type { CanvasNode, NodeId } from '@/domain/node'
import { nodeCenter, type Point } from '@/domain/spatialInfluence'

/** A target top-left for one member, in world coordinates (the `spatial.x/y` frame). */
export interface ClusterPlacement {
	id: NodeId
	x: number
	y: number
}

export interface ClusterLayoutOptions {
	/** Gap between packed members, world units. */
	gap?: number
	/** Clearance to keep from every non-member. */
	margin?: number
	/** How many times to try sliding clear of non-members before giving up. */
	maxIterations?: number
}

export const DEFAULT_CLUSTER_GAP = 40
export const DEFAULT_CLUSTER_MARGIN = 60
export const DEFAULT_CLUSTER_ITERATIONS = 24

interface Aabb {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

function compareId(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/** The axis-aligned bounds of a box at `(x, y)`, accounting for its rotation. */
function boxAabb(x: number, y: number, width: number, height: number, rotation: number): Aabb {
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const [dx, dy] of [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	]) {
		const px = x + dx * cos - dy * sin
		const py = y + dx * sin + dy * cos
		minX = Math.min(minX, px)
		minY = Math.min(minY, py)
		maxX = Math.max(maxX, px)
		maxY = Math.max(maxY, py)
	}
	return { minX, minY, maxX, maxY }
}

function nodeAabb(node: CanvasNode): Aabb {
	const { x, y, width, height, rotation } = node.spatial
	return boxAabb(x, y, width, height, rotation)
}

/** The top-left a node must have for its centre to land on `center`, rotation included. */
function topLeftForCenter(node: CanvasNode, center: Point): Point {
	const { width, height, rotation } = node.spatial
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	return {
		x: center.x - (width / 2) * cos + (height / 2) * sin,
		y: center.y - (width / 2) * sin - (height / 2) * cos,
	}
}

function unionAabb(boxes: Aabb[]): Aabb {
	return {
		minX: Math.min(...boxes.map((b) => b.minX)),
		minY: Math.min(...boxes.map((b) => b.minY)),
		maxX: Math.max(...boxes.map((b) => b.maxX)),
		maxY: Math.max(...boxes.map((b) => b.maxY)),
	}
}

function expand(box: Aabb, by: number): Aabb {
	return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by }
}

function intersects(a: Aabb, b: Aabb): boolean {
	return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/** The smallest single-axis nudge that moves `cluster` out of `obstacle`. */
function minTranslation(cluster: Aabb, obstacle: Aabb): Point {
	// A hair past the edge, so floating equality can't re-trigger the same overlap.
	const epsilon = 0.5
	const pushRight = obstacle.maxX - cluster.minX + epsilon
	const pushLeft = cluster.maxX - obstacle.minX + epsilon
	const pushDown = obstacle.maxY - cluster.minY + epsilon
	const pushUp = cluster.maxY - obstacle.minY + epsilon

	const x = pushRight <= pushLeft ? pushRight : -pushLeft
	const y = pushDown <= pushUp ? pushDown : -pushUp

	return Math.abs(x) <= Math.abs(y) ? { x, y: 0 } : { x: 0, y }
}

export function computeClusterLayout(
	members: CanvasNode[],
	others: CanvasNode[],
	options: ClusterLayoutOptions = {}
): ClusterPlacement[] {
	const gap = options.gap ?? DEFAULT_CLUSTER_GAP
	const margin = options.margin ?? DEFAULT_CLUSTER_MARGIN
	const maxIterations = options.maxIterations ?? DEFAULT_CLUSTER_ITERATIONS

	if (members.length === 0) return []
	if (members.length === 1) {
		const only = members[0]
		return [{ id: only.id, x: only.spatial.x, y: only.spatial.y }]
	}

	const byId = new Map(members.map((node) => [node.id, node]))

	// Order by nearness to the shared centre, tie-broken by id, so the packing is
	// stable and the least-travelled members stay nearest the middle.
	const centers = new Map(members.map((node) => [node.id, nodeCenter(node)]))
	const centroid: Point = {
		x: [...centers.values()].reduce((sum, c) => sum + c.x, 0) / members.length,
		y: [...centers.values()].reduce((sum, c) => sum + c.y, 0) / members.length,
	}
	const ordered = [...members].sort((a, b) => {
		const da = distanceSquared(centers.get(a.id)!, centroid)
		const db = distanceSquared(centers.get(b.id)!, centroid)
		return da - db || compareId(a.id, b.id)
	})

	// Uniform cells sized by the largest member footprint, so no two boxes overlap
	// whatever their sizes or rotations.
	const footprints = members.map(nodeAabb)
	const cellWidth = Math.max(...footprints.map((f) => f.maxX - f.minX)) + gap
	const cellHeight = Math.max(...footprints.map((f) => f.maxY - f.minY)) + gap

	const columns = Math.ceil(Math.sqrt(ordered.length))
	const rows = Math.ceil(ordered.length / columns)
	const gridLeft = centroid.x - (columns * cellWidth) / 2
	const gridTop = centroid.y - (rows * cellHeight) / 2

	let placements: ClusterPlacement[] = ordered.map((node, index) => {
		const column = index % columns
		const row = Math.floor(index / columns)
		const cellCenter: Point = {
			x: gridLeft + column * cellWidth + cellWidth / 2,
			y: gridTop + row * cellHeight + cellHeight / 2,
		}
		const topLeft = topLeftForCenter(node, cellCenter)
		return { id: node.id, x: topLeft.x, y: topLeft.y }
	})

	// Slide the whole rigid block off any non-member it lands on. Obstacles are the
	// non-members' fixed bounds, padded by the clearance margin.
	const obstacles = others.map((node) => expand(nodeAabb(node), margin))
	const placementAabb = (placement: ClusterPlacement): Aabb => {
		const node = byId.get(placement.id)!
		return boxAabb(placement.x, placement.y, node.spatial.width, node.spatial.height, node.spatial.rotation)
	}

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const cluster = unionAabb(placements.map(placementAabb))
		const hit = obstacles.find((obstacle) => intersects(cluster, obstacle))
		if (!hit) break
		const shift = minTranslation(cluster, hit)
		placements = placements.map((placement) => ({
			id: placement.id,
			x: placement.x + shift.x,
			y: placement.y + shift.y,
		}))
	}

	return placements
}

function distanceSquared(a: Point, b: Point): number {
	const dx = a.x - b.x
	const dy = a.y - b.y
	return dx * dx + dy * dy
}
