/**
 * What changed between two canvases.
 *
 * The rest of the model describes a canvas at one instant. This is the only
 * module with any notion of *before*, and it acquires one the cheapest way
 * available: by being handed two documents and comparing them. There is no
 * listener, no log and no history — a caller that wants change detection holds
 * its own snapshots and calls this, which is what keeps `CanvasDocument` a pure
 * function of the store and leaves nothing to invalidate.
 *
 * It **reads** the derived layers rather than recomputing them. Both documents
 * already carry `influences` and `effectiveStrengths`, rounded and derived, so
 * recomputing here would risk reporting numbers that disagree with the JSON the
 * caller is holding. Comparison is therefore exact equality on already-rounded
 * values, and a change too small to appear in the document cannot appear in a
 * diff of it.
 *
 * Two lists come back, not one tree. See `CanvasDiff`.
 *
 * Pure, no tldraw.
 */
import type { CanvasDocument, Relation, RelationId } from '@/domain/canvas'
import type { CanvasNode, NodeId } from '@/domain/node'
import type { EffectiveStrength } from '@/domain/effectiveStrength'
import { DISTANCE_PRECISION, nodeCenter, type Point } from '@/domain/spatialInfluence'
import type { SpatialInfluence } from '@/domain/spatialInfluence'

/** The two nodes a relation connects. */
export interface RelationEndpoints {
	source: NodeId
	target: NodeId
}

/**
 * One thing that happened, as an action rather than a consequence.
 *
 * The eight kinds cover the six MVP 0 lists — node position, creation, deletion,
 * contextual-field radius, relation creation, relation deletion, relation
 * source/target — plus `relation_gravity_changed`, which the list omits although
 * the style panel already lets a user do it, and which moves every combined
 * number on the pair.
 */
export type CanvasChange =
	| { kind: 'node_created'; node: NodeId }
	| { kind: 'node_deleted'; node: NodeId }
	/**
	 * Centres, not corners. `spatial.rotation` is applied about the unrotated box's
	 * top-left and a resize changes width or height, so a rotation and a resize both
	 * move the centre and therefore every distance the document reports — while
	 * `spatial.x`/`y` may not have changed at all. Comparing the centre is what
	 * makes one kind cover all three cases honestly instead of missing two of them.
	 */
	| { kind: 'node_moved'; node: NodeId; before: Point; after: Point }
	/**
	 * `before`/`after` are absent when there was no field, never `0`. A node that
	 * had no contextual field and now has one is a different event from a node whose
	 * radius was widened from nothing, and `0` is itself a claim the user can make.
	 */
	| { kind: 'contextual_field_changed'; node: NodeId; before?: number; after?: number }
	| {
			kind: 'relation_created'
			relation: RelationId
			endpoints: RelationEndpoints
			gravity: number
	  }
	| {
			kind: 'relation_deleted'
			relation: RelationId
			endpoints: RelationEndpoints
			gravity: number
	  }
	/**
	 * Dragging one end of an arrow onto a different note. Detectable as an update
	 * rather than a delete plus a create because `RelationId` derives from the
	 * arrow's shape id, which survives re-binding.
	 */
	| {
			kind: 'relation_rebound'
			relation: RelationId
			before: RelationEndpoints
			after: RelationEndpoints
	  }
	| { kind: 'relation_gravity_changed'; relation: RelationId; before: number; after: number }

/**
 * One number, across the two documents.
 *
 * All three fields are optional because a pair can exist on only one side. When a
 * node is created, the pairs it forms have an `after` distance and no `before`
 * one — which is a different statement from a distance that changed to that
 * value, and collapsing the two by inventing a `before` of `0` would be a lie
 * about a node that did not exist.
 */
export interface Delta {
	/** Absent when the value did not exist before — a created node, a new relation. */
	before?: number
	/** Absent when the value no longer exists — a deleted node, a removed relation. */
	after?: number
	/** `after − before`. Present only when both are. */
	delta?: number
}

/**
 * What changed for one directed pair.
 *
 * `gravity` and `effectiveStrength` are absent entirely for a pair the user never
 * connected — absent, not zero, following the rest of the model. A pair that
 * gained a relation has them with an `after` and no `before`.
 */
export interface PairDelta {
	source: NodeId
	target: NodeId

	distance?: Delta
	influence?: Delta
	gravity?: Delta
	effectiveStrength?: Delta
}

/**
 * Actions and consequences, side by side — deliberately not nested.
 *
 * MVP 0's examples read as `A moved closer to B → influence increased`, and for a
 * single action that reading is recoverable: join the one `node_moved` against the
 * `pairs` it touches. What it must not do is *assert* that join. When two nodes
 * both move, deciding which one caused a given pair's influence to rise is an
 * inference, and inferring causality is precisely what MVP 0 §6 rules out. So the
 * diff reports what the user did and what the numbers did, and leaves the arrow
 * between them to a reader who can see whether it is warranted.
 */
export interface CanvasDiff {
	changes: CanvasChange[]
	pairs: PairDelta[]
}

/** Sort order for `changes`: structure before geometry, nodes before relations. */
const CHANGE_ORDER: CanvasChange['kind'][] = [
	'node_created',
	'node_deleted',
	'node_moved',
	'contextual_field_changed',
	'relation_created',
	'relation_deleted',
	'relation_rebound',
	'relation_gravity_changed',
]

/**
 * Everything that changed between two documents.
 *
 * Argument order is `(before, after)`, and every `delta` is `after − before`, so
 * a positive influence delta means the pair drew closer in the sense the document
 * reports.
 *
 * Passing the same document twice returns two empty lists.
 */
export function diffCanvas(before: CanvasDocument, after: CanvasDocument): CanvasDiff {
	return {
		changes: [...nodeChanges(before, after), ...relationChanges(before, after)].sort(
			compareChanges
		),
		pairs: pairDeltas(before, after),
	}
}

function nodeChanges(before: CanvasDocument, after: CanvasDocument): CanvasChange[] {
	const changes: CanvasChange[] = []

	for (const id of Object.keys(after.nodes)) {
		if (!before.nodes[id]) changes.push({ kind: 'node_created', node: id })
	}

	for (const id of Object.keys(before.nodes)) {
		if (!after.nodes[id]) changes.push({ kind: 'node_deleted', node: id })
	}

	for (const [id, next] of Object.entries(after.nodes)) {
		const previous = before.nodes[id]
		if (!previous) continue

		changes.push(...movement(id, previous, next))
		changes.push(...fieldChange(id, previous, next))
	}

	return changes
}

function movement(id: NodeId, previous: CanvasNode, next: CanvasNode): CanvasChange[] {
	const from = roundPoint(nodeCenter(previous))
	const to = roundPoint(nodeCenter(next))

	if (from.x === to.x && from.y === to.y) return []

	return [{ kind: 'node_moved', node: id, before: from, after: to }]
}

function fieldChange(id: NodeId, previous: CanvasNode, next: CanvasNode): CanvasChange[] {
	const from = previous.contextualField?.radius
	const to = next.contextualField?.radius

	if (from === to) return []

	return [
		{
			kind: 'contextual_field_changed',
			node: id,
			// Spread, so "had no field" produces no key at all rather than one set to
			// undefined — the same treatment `contextualField` itself gets.
			...(from === undefined ? {} : { before: from }),
			...(to === undefined ? {} : { after: to }),
		},
	]
}

function relationChanges(before: CanvasDocument, after: CanvasDocument): CanvasChange[] {
	const changes: CanvasChange[] = []

	for (const [id, relation] of Object.entries(after.relations)) {
		if (before.relations[id]) continue
		changes.push({
			kind: 'relation_created',
			relation: id,
			endpoints: endpoints(relation),
			gravity: relation.gravity,
		})
	}

	for (const [id, relation] of Object.entries(before.relations)) {
		if (after.relations[id]) continue
		changes.push({
			kind: 'relation_deleted',
			relation: id,
			endpoints: endpoints(relation),
			gravity: relation.gravity,
		})
	}

	for (const [id, next] of Object.entries(after.relations)) {
		const previous = before.relations[id]
		if (!previous) continue

		if (previous.from !== next.from || previous.to !== next.to) {
			changes.push({
				kind: 'relation_rebound',
				relation: id,
				before: endpoints(previous),
				after: endpoints(next),
			})
		}

		// Reported independently of a rebind: an arrow can be moved and reweighted in
		// the same interval, and the two are separate things the user did.
		if (previous.gravity !== next.gravity) {
			changes.push({
				kind: 'relation_gravity_changed',
				relation: id,
				before: previous.gravity,
				after: next.gravity,
			})
		}
	}

	return changes
}

function endpoints(relation: Relation): RelationEndpoints {
	return { source: relation.from, target: relation.to }
}

/**
 * Every directed pair whose numbers moved.
 *
 * Built from the union of pairs across both documents, so a pair that only exists
 * on one side still reports the side it has. Pairs where nothing changed are
 * dropped: the diff is a statement about change, and a canvas of 20 nodes has 380
 * pairs of which a single drag moves 38.
 */
function pairDeltas(before: CanvasDocument, after: CanvasDocument): PairDelta[] {
	const previousInfluence = byPair(before.spatialContext?.influences)
	const nextInfluence = byPair(after.spatialContext?.influences)
	const previousCombined = byPair(before.spatialContext?.effectiveStrengths)
	const nextCombined = byPair(after.spatialContext?.effectiveStrengths)

	const keys = new Set([
		...previousInfluence.keys(),
		...nextInfluence.keys(),
		...previousCombined.keys(),
		...nextCombined.keys(),
	])

	const deltas: PairDelta[] = []

	for (const key of keys) {
		const influenceBefore = previousInfluence.get(key)
		const influenceAfter = nextInfluence.get(key)
		const combinedBefore = previousCombined.get(key)
		const combinedAfter = nextCombined.get(key)

		const distance = delta(influenceBefore?.distance, influenceAfter?.distance)
		const influence = delta(influenceBefore?.influence, influenceAfter?.influence)
		const gravity = delta(combinedBefore?.gravity, combinedAfter?.gravity)
		const effectiveStrength = delta(
			combinedBefore?.effectiveStrength,
			combinedAfter?.effectiveStrength
		)

		if (!distance && !influence && !gravity && !effectiveStrength) continue

		const [source, target] = splitPair(key)

		deltas.push({
			source,
			target,
			...(distance ? { distance } : {}),
			...(influence ? { influence } : {}),
			...(gravity ? { gravity } : {}),
			...(effectiveStrength ? { effectiveStrength } : {}),
		})
	}

	return deltas.sort(comparePairs)
}

/**
 * A `Delta` for one number, or `undefined` if it did not change.
 *
 * Equality is exact because both inputs come from a document, where they were
 * already rounded to the precision the JSON reports. That is the epsilon: there
 * is no float noise left to tolerate, and no change is reported that a reader
 * could not see for themselves.
 */
function delta(before: number | undefined, after: number | undefined): Delta | undefined {
	if (before === undefined && after === undefined) return undefined
	if (before === after) return undefined

	if (before === undefined) return { after: after as number }
	if (after === undefined) return { before }

	return { before, after, delta: round(after - before) }
}

/**
 * The magnitude a pair is ranked by: the larger of its two 0–1 signals' shifts.
 *
 * Distance is deliberately excluded. It is unbounded world units, so a pair that
 * slid 900 units without leaving either node's field would outrank one whose
 * influence collapsed — ordering the list by the number that changed least
 * meaningfully.
 */
function magnitude(pair: PairDelta): number {
	return Math.max(
		Math.abs(pair.influence?.delta ?? 0),
		Math.abs(pair.effectiveStrength?.delta ?? 0)
	)
}

function comparePairs(a: PairDelta, b: PairDelta): number {
	return (
		magnitude(b) - magnitude(a) ||
		a.source.localeCompare(b.source) ||
		a.target.localeCompare(b.target)
	)
}

function compareChanges(a: CanvasChange, b: CanvasChange): number {
	return (
		CHANGE_ORDER.indexOf(a.kind) - CHANGE_ORDER.indexOf(b.kind) ||
		subject(a).localeCompare(subject(b))
	)
}

function subject(change: CanvasChange): string {
	return 'node' in change ? change.node : change.relation
}

/**
 * A directed pair key, matching `effectiveStrength.ts`.
 *
 * `\u0000` rather than a printable separator, and here it is load-bearing rather
 * than merely tidy: `splitPair` reads the key apart again, so a NodeId containing
 * the separator would not just collide — it would hand back two ids that are not
 * the ones that went in. A `NodeId` is only required to be a string, and an
 * imported document is typed by assertion, so a space is not safe to assume out
 * of one. A NUL cannot survive the round trip that produces an id.
 */
function pairKey(source: NodeId, target: NodeId): string {
	return `${source}\u0000${target}`
}

function splitPair(key: string): [NodeId, NodeId] {
	const separator = key.indexOf('\u0000')
	return [key.slice(0, separator), key.slice(separator + 1)]
}

function byPair<T extends SpatialInfluence | EffectiveStrength>(
	rows: T[] | undefined
): Map<string, T> {
	const index = new Map<string, T>()
	for (const row of rows ?? []) index.set(pairKey(row.source, row.target), row)
	return index
}

function roundPoint(point: Point): Point {
	return { x: round(point.x, DISTANCE_PRECISION), y: round(point.y, DISTANCE_PRECISION) }
}

/** Defaults to the 3dp the 0–1 signals use; a delta of rounded values needs no more. */
function round(value: number, decimals = 3): number {
	const factor = 10 ** decimals
	return Math.round(value * factor) / factor
}
