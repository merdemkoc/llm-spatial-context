/**
 * Spatial proximity, expressed as a number.
 *
 * The question this answers: if two nodes sit near each other on a canvas, how
 * much context does one lend the other? The answer here is deliberately the
 * dumbest possible one — a linear falloff over centre-to-centre distance — so
 * that proximity can be evaluated as a signal before anything semantic is built
 * on top of it.
 *
 * Everything in this module is pure and derived. Influence is never written back
 * into a Node: it is a function of two Nodes' geometry and the source's radius,
 * which is what makes "move a node and its context changes" true by
 * construction rather than by invalidation.
 */
import type { CanvasNode, NodeId } from '@/domain/node'

export interface SpatialInfluence {
	sourceId: NodeId
	targetId: NodeId

	/** World units, centre to centre. Independent of either node's radius. */
	distance: number

	/** 0–1. Directional: it depends on the *source's* radius, not the target's. */
	influence: number
}

export interface Point {
	x: number
	y: number
}

/**
 * The true centre of a Node's box.
 *
 * Not `x + width / 2`. `SpatialProperties.rotation` is applied about the
 * unrotated box's top-left corner rather than its centre, so for any rotated
 * node the naive midpoint is a point that has itself been rotated away. Getting
 * this wrong would make distances quietly depend on rotation in the wrong
 * direction, which is the sort of error that survives a whole experiment.
 */
export function nodeCenter(node: CanvasNode): Point {
	const { x, y, width, height, rotation } = node.spatial

	const halfWidth = width / 2
	const halfHeight = height / 2

	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)

	return {
		x: x + halfWidth * cos - halfHeight * sin,
		y: y + halfWidth * sin + halfHeight * cos,
	}
}

/**
 * Euclidean distance between two Nodes' centres.
 *
 * Centre to centre only. Edge-to-edge distance would be the more physically
 * intuitive measure, but it makes influence depend on node size in a way that
 * has to be justified separately — not part of this experiment.
 */
export function distanceBetweenNodes(source: CanvasNode, target: CanvasNode): number {
	const sourceCenter = nodeCenter(source)
	const targetCenter = nodeCenter(target)

	return Math.hypot(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y)
}

/**
 * How much `source` influences `target`, in the range 0–1.
 *
 * Linear falloff: `1` when the centres coincide, `0` at and beyond the radius.
 *
 * Directional. Two nodes 100 units apart influence each other by different
 * amounts whenever their radii differ, without any semantic relation being
 * involved — the geometry alone is asymmetric.
 *
 * Returns `0` rather than throwing for every degenerate input. A canvas is an
 * unvalidated document and a missing or nonsensical radius is a normal state to
 * be in, not an error to interrupt a render for.
 */
export function calculateSpatialInfluence(source: CanvasNode, target: CanvasNode): number {
	if (source.id === target.id) return 0

	const radius = source.contextualField?.radius
	// `Number.isFinite` and not `radius <= 0`: NaN fails every comparison, so a
	// NaN radius would slip past a bare `<= 0` guard and leak NaN out of a
	// function contracted to return 0–1.
	if (radius === undefined || !Number.isFinite(radius) || radius <= 0) return 0

	return Math.max(0, 1 - distanceBetweenNodes(source, target) / radius)
}

/**
 * Every directed pair. `N` nodes produce `N² − N` rows: self-pairs are omitted
 * entirely rather than included as zeroes, since a node influencing itself isn't
 * a relationship that exists.
 *
 * Zero-influence rows are kept. They are the difference between "these nodes are
 * out of range of each other" and "we didn't look", and a caller that doesn't
 * want them can filter.
 *
 * Order is source-major, following the input array, so results are stable enough
 * to assert on. Callers reading from `CanvasDocument.nodes` — a Record — get
 * insertion order, which is not meaningful; sort first if it needs to be.
 */
export function calculateSpatialInfluences(nodes: CanvasNode[]): SpatialInfluence[] {
	const influences: SpatialInfluence[] = []

	for (let i = 0; i < nodes.length; i++) {
		for (let j = 0; j < nodes.length; j++) {
			// By index, so the row count is exactly N² − N whatever the ids are.
			if (i === j) continue

			const source = nodes[i]
			const target = nodes[j]

			influences.push({
				sourceId: source.id,
				targetId: target.id,
				distance: distanceBetweenNodes(source, target),
				influence: calculateSpatialInfluence(source, target),
			})
		}
	}

	return influences
}
