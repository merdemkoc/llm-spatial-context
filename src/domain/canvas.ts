/**
 * The root canonical model.
 *
 * Relations are graph-level entities, deliberately held here rather than
 * embedded inside Nodes: an arrow belongs to the graph, not to either end of it.
 *
 * The document holds four distinct layers, and keeping them distinct is the
 * whole design:
 *
 *   nodes[].spatial + contextualField   where a node is, and how far it reaches
 *   spatialContext                      what the layout implies, derived
 *   relations                           what the user said, explicitly — and how
 *                                       strongly they said it
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
	 * How strongly the user asserted this relationship. 0–1.
	 *
	 * A second strength signal, independent of the one in `spatialContext`: that is
	 * what the layout implies, this is what the user said. Nothing here is derived
	 * from distance, and moving either node leaves it untouched — two nodes 484 units
	 * apart can report a spatial influence of `0.032` and a gravity of `1`, and that
	 * disagreement is information rather than an inconsistency to resolve. The two
	 * are deliberately never combined into one number.
	 *
	 * Directional like the rest of the record: `from → to` at this strength says
	 * nothing about `to → from`, which exists only if the user drew it too.
	 */
	gravity: number

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

/**
 * What drawing an arrow asserts, before the user says anything more.
 *
 * `gravity` is required and defaulted where `type` is optional and never
 * defaulted, and the difference is not an inconsistency: `type` is a *word the
 * user chose*, so inventing one would invent the claim. Gravity is the strength
 * of *the gesture itself*, and connecting two notes on purpose is the strongest
 * assertion this tool can make — so the default is what the act already meant,
 * not a guess about content.
 *
 * That is also what makes an arrow drawn before this field existed read back as a
 * full-strength relation rather than a broken one.
 */
export const DEFAULT_RELATION_GRAVITY = 1

/** Enough to see a deliberate 0.35 or 0.05; beyond this it's float noise. */
const GRAVITY_PRECISION = 3

/**
 * Reads an unvalidated value as a gravity.
 *
 * Takes `unknown` on purpose: every source of a gravity is untrusted. It arrives
 * from `shape.meta` — JSON tldraw stores but never inspects — or from an imported
 * document typed only by assertion, and neither can be relied on to hold a number
 * in range.
 *
 * A gravity of `0` is **kept**, not treated as absent, exactly as a
 * `contextualField.radius` of `0` is: "connected, but the user says barely" is a
 * claim, and scrubbing it back to the default would silently overrule them. Only
 * a value that isn't a usable number at all falls back.
 *
 * Out of range is clamped rather than rejected. `1.5` is not a different kind of
 * claim from `1` — it's the same claim with a broken scale, and the scale is what
 * this function owns. Rounded here, once, at the boundary, for the same reason
 * `buildSpatialContext` rounds: the store, the JSON and the UI then cannot
 * disagree about the number.
 */
export function clampGravity(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RELATION_GRAVITY

	const factor = 10 ** GRAVITY_PRECISION
	return Math.round(Math.min(1, Math.max(0, value)) * factor) / factor
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
