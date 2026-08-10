/**
 * The root canonical model.
 *
 * Relations are graph-level entities, deliberately held here rather than
 * embedded inside Nodes. Nothing implements them yet — the point is that the
 * architecture already has the right place for them, so adding relations later
 * doesn't require redesigning the Canvas abstraction.
 *
 * The document holds three distinct layers, and keeping them distinct is the
 * whole design:
 *
 *   nodes[].spatial + contextualField   where a node is, and how far it reaches
 *   spatialContext                      what the layout implies, derived
 *   relations                           what the user said, explicitly
 *
 * A reader gets both the structure that was stated and the structure that was
 * only arranged, without either being mistaken for the other.
 */
import type { CanvasNode, NodeId } from '@/domain/node'
import type { SpatialContext } from '@/domain/spatialInfluence'

export type CanvasId = string

export type RelationId = string

/**
 * Placeholder. Deliberately not modelled on tldraw's binding system: bindings
 * are the right projection for relations that affect geometry, but most
 * relations here are expected to be semantic and shouldn't inherit binding
 * lifecycle rules. The shape of this type is expected to change.
 */
export interface Relation {
	id: RelationId
	type: string
	from: NodeId
	to: NodeId
}

export interface CanvasMetadata {
	/** ISO 8601. */
	createdAt: string
	/** ISO 8601. */
	updatedAt: string
}

export interface CanvasDocument {
	id: CanvasId

	nodes: Record<NodeId, CanvasNode>

	/** What the user connected on purpose. Never inferred from proximity. */
	relations: Record<RelationId, Relation>

	/**
	 * Derived, never stored. Recomputed from node geometry every time the
	 * document is read, which is what keeps it true after a move, a resize, a
	 * radius change, an addition or a deletion without anything to invalidate.
	 *
	 * Round-tripping a document therefore ignores whatever `spatialContext` it
	 * carried: it is output, not input.
	 */
	spatialContext: SpatialContext

	metadata: CanvasMetadata
}
