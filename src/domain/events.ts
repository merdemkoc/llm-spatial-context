/**
 * A diff, restated as a stream of events.
 *
 * `canvasDiff` answers "what is different between these two canvases" as two flat
 * lists. This module answers the next question — "what *happened*" — as an ordered
 * sequence a subscriber can react to one item at a time. It is the substrate the
 * MVP 1 spec calls for: the same structured record whether a human reads it in the
 * event log or a future AI observer consumes it, with no need to reconstruct spatial
 * state from a screenshot.
 *
 * It adds nothing the diff did not already contain. Structural events are the eight
 * `CanvasChange` kinds renamed to a subscriber's vocabulary; the spatial events —
 * `field_entered`, `field_exited`, `influence_changed`, `proximity_changed` — are
 * *classifications* of a pair's influence delta, which the diff carries but does not
 * name. Because the inputs are already rounded to the precision the document reports,
 * an event too small to see in the JSON cannot appear here either.
 *
 * Pure, no tldraw.
 */
import type { NodeId } from '@/domain/node'
import type { RelationId } from '@/domain/canvas'
import type { Point } from '@/domain/spatialInfluence'
import type { CanvasChange, CanvasDiff, PairDelta, RelationEndpoints } from '@/domain/canvasDiff'

/**
 * The two 0–1 influence thresholds that split "in a field" into proximity bands.
 *
 * A pair is *strongly* proximate at or above `STRONG_PROXIMITY` and *weakly* so at or
 * below `WEAK_PROXIMITY` while still in range. Between them it is simply in the field.
 * These are tunable presentation constants, not model facts — they classify a
 * continuous influence into the discrete transitions MVP 1 §4 asks to detect, and
 * nothing downstream stores them.
 */
export const STRONG_PROXIMITY = 0.66
export const WEAK_PROXIMITY = 0.33

/** A pair's spatial state at one instant. `distance` is absent only when it did not change. */
export interface PairSnapshot {
	/** World units, centre to centre. */
	distance?: number
	/** 0–1, directional on the source's radius. */
	influence: number
}

/**
 * One thing that happened, ready to hand to a subscriber.
 *
 * Structural events name a change to what exists; spatial events name a change to what
 * the layout implies for one directed pair. Every spatial event carries `previous` and
 * `current` so the transition is legible without holding the surrounding snapshots —
 * the "preserve enough to understand the transition" the spec asks for.
 */
export type SpatialEvent =
	| { type: 'node_created'; nodeId: NodeId }
	| { type: 'node_deleted'; nodeId: NodeId }
	| { type: 'node_moved'; nodeId: NodeId; previous: Point; current: Point }
	/** `previous`/`current` are absent when there was no field, never `0` — matching the diff. */
	| { type: 'contextual_field_changed'; nodeId: NodeId; previous?: number; current?: number }
	| {
			type: 'relation_created'
			relationId: RelationId
			source: NodeId
			target: NodeId
			gravity: number
	  }
	| {
			type: 'relation_deleted'
			relationId: RelationId
			source: NodeId
			target: NodeId
			gravity: number
	  }
	| {
			type: 'relation_rebound'
			relationId: RelationId
			previous: RelationEndpoints
			current: RelationEndpoints
	  }
	| { type: 'relation_gravity_changed'; relationId: RelationId; previous: number; current: number }
	| {
			type: 'field_entered'
			source: NodeId
			target: NodeId
			previous: PairSnapshot
			current: PairSnapshot
	  }
	| {
			type: 'field_exited'
			source: NodeId
			target: NodeId
			previous: PairSnapshot
			current: PairSnapshot
	  }
	| {
			type: 'influence_changed'
			source: NodeId
			target: NodeId
			previous: PairSnapshot
			current: PairSnapshot
	  }
	| {
			type: 'proximity_changed'
			source: NodeId
			target: NodeId
			/** `strong` on crossing up over `STRONG_PROXIMITY`, `weak` on dropping under `WEAK_PROXIMITY` in field. */
			level: 'strong' | 'weak'
			previous: PairSnapshot
			current: PairSnapshot
	  }

/**
 * Every event in a diff, structural before spatial.
 *
 * Structural events keep the diff's own order (structure before geometry, nodes before
 * relations); spatial events follow, in the diff's pair order (largest signal shift
 * first). Ordering is stable so a caller — or a test — can rely on it.
 */
export function deriveEvents(diff: CanvasDiff): SpatialEvent[] {
	return [...diff.changes.map(structuralEvent), ...diff.pairs.flatMap(pairEvents)]
}

function structuralEvent(change: CanvasChange): SpatialEvent {
	switch (change.kind) {
		case 'node_created':
			return { type: 'node_created', nodeId: change.node }
		case 'node_deleted':
			return { type: 'node_deleted', nodeId: change.node }
		case 'node_moved':
			return {
				type: 'node_moved',
				nodeId: change.node,
				previous: change.before,
				current: change.after,
			}
		case 'contextual_field_changed':
			// Spread, so an absent side produces no key rather than one set to undefined —
			// the same treatment the diff and the Node model give a missing field.
			return {
				type: 'contextual_field_changed',
				nodeId: change.node,
				...(change.before === undefined ? {} : { previous: change.before }),
				...(change.after === undefined ? {} : { current: change.after }),
			}
		case 'relation_created':
			return {
				type: 'relation_created',
				relationId: change.relation,
				source: change.endpoints.source,
				target: change.endpoints.target,
				gravity: change.gravity,
			}
		case 'relation_deleted':
			return {
				type: 'relation_deleted',
				relationId: change.relation,
				source: change.endpoints.source,
				target: change.endpoints.target,
				gravity: change.gravity,
			}
		case 'relation_rebound':
			return {
				type: 'relation_rebound',
				relationId: change.relation,
				previous: change.before,
				current: change.after,
			}
		case 'relation_gravity_changed':
			return {
				type: 'relation_gravity_changed',
				relationId: change.relation,
				previous: change.before,
				current: change.after,
			}
	}
}

/**
 * The spatial events for one pair, classified by its influence delta.
 *
 * A pair only produces spatial events when its influence changed *and existed on both
 * sides*: a pair that appeared or vanished is a created/deleted node, already reported
 * structurally, and calling that a field crossing would double-count it. Given both
 * ends, the influence's endpoints say which transition it was — a boundary crossing at
 * zero, a change within the field, or a proximity band crossing (which can co-occur
 * with a within-field change).
 */
function pairEvents(pair: PairDelta): SpatialEvent[] {
	const influence = pair.influence
	if (!influence || influence.before === undefined || influence.after === undefined) return []

	const before = influence.before
	const after = influence.after
	const previous = snapshot(pair.distance?.before, before)
	const current = snapshot(pair.distance?.after, after)
	const { source, target } = pair

	const out: SpatialEvent[] = []

	if (before === 0 && after > 0) {
		out.push({ type: 'field_entered', source, target, previous, current })
	} else if (before > 0 && after === 0) {
		out.push({ type: 'field_exited', source, target, previous, current })
	} else {
		// Both ends inside the field: the influence changed without crossing the boundary.
		out.push({ type: 'influence_changed', source, target, previous, current })
	}

	if (before < STRONG_PROXIMITY && after >= STRONG_PROXIMITY) {
		out.push({ type: 'proximity_changed', source, target, level: 'strong', previous, current })
	} else if (after > 0 && before > WEAK_PROXIMITY && after <= WEAK_PROXIMITY) {
		out.push({ type: 'proximity_changed', source, target, level: 'weak', previous, current })
	}

	return out
}

function snapshot(distance: number | undefined, influence: number): PairSnapshot {
	return distance === undefined ? { influence } : { distance, influence }
}
