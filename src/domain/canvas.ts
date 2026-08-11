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
 *   grounding                           where a node is in a screenshot, derived
 *
 * A reader gets both the structure that was stated and the structure that was
 * only arranged, without either being mistaken for the other.
 *
 * The first three speak in canvas coordinates; `grounding` speaks in screenshot
 * pixels. Keeping that boundary visible is the point of holding it as its own
 * layer rather than adding pixel fields to `spatial`.
 */
import type { CanvasNode, NodeId } from '@/domain/node'
import type { Grounding } from '@/domain/grounding'
import type { SpatialContext } from '@/domain/spatialInfluence'

export type CanvasId = string

export type RelationId = string

/**
 * One thing the user said, explicitly: *these two are related*.
 *
 * Deliberately not modelled on tldraw's binding system. A relation is projected
 * from an arrow whose ends are bound to two nodes, but nothing about the binding
 * reaches this type — no `normalizedAnchor`, no `isPrecise`, no terminal. The
 * binding is *how the arrow is drawn*; this is *what it means*. Keeping the two
 * apart is why a relation survives being redrawn, and why the canonical model
 * doesn't inherit binding lifecycle rules.
 *
 * Directional. `from` and `to` follow the arrow's own direction; arrowhead
 * styling is visual and carries no meaning here, the same way node colour
 * doesn't.
 */
export interface Relation {
	id: RelationId

	from: NodeId
	to: NodeId

	/**
	 * What the user called it — the arrow's label.
	 *
	 * Optional and **never defaulted**. An unlabelled arrow means "connected, and
	 * the user didn't say why", which is a different claim from `related_to`;
	 * inventing that word would be exactly the inference this model refuses to
	 * make. Same rule as `ContextualField`: absent and empty are different states.
	 */
	type?: string
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

	/**
	 * Derived, never stored — like `spatialContext`, and for the same reason: it is
	 * a function of node geometry, so it stays true after a move with nothing to
	 * invalidate. Importing a document ignores whatever `grounding` it carried.
	 *
	 * It describes the screenshot the canvas *would* export right now. The export
	 * itself measures the bitmap it actually produced and replaces this with the
	 * measured version, so a downloaded artifact always describes its own PNG.
	 */
	grounding: Grounding

	metadata: CanvasMetadata
}
