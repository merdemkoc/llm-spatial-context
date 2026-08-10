/**
 * The root canonical model.
 *
 * Relations are graph-level entities, deliberately held here rather than
 * embedded inside Nodes. Nothing implements them yet — the point is that the
 * architecture already has the right place for them, so adding relations later
 * doesn't require redesigning the Canvas abstraction.
 */
import type { CanvasNode, NodeId } from '@/domain/node'

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

	relations: Record<RelationId, Relation>

	metadata: CanvasMetadata
}
