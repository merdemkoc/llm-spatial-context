/**
 * The projection between a relation arrow and a canonical Relation.
 *
 * A relation is an arrow whose two ends are bound to post-its. tldraw already
 * owns the hard part — drawing it, binding it, re-routing it when a note moves —
 * so nothing here draws anything. It reads.
 *
 * What separates a relation from a decorative arrow is `meta.relation`, written
 * by `RelationTool` at creation. Not the shape type (both are `arrow`), and not
 * the styling: the user may restyle an arrow freely without changing what it
 * means.
 *
 * Nothing in this module looks at geometry. Two notes being close produces no
 * relation, and a relation produces no influence — `spatialContext` and
 * `relations` are answers to different questions and are derived from different
 * inputs.
 *
 * That holds for strength too. A relation's `gravity` is read from the arrow's
 * meta and from nothing else, so it is unmoved by the distance the notes happen to
 * sit at, while `spatialContext` is unmoved by the arrow. Two strength signals,
 * never combined.
 */
import type { Editor, TLArrowBinding, TLShape, TLShapeId } from 'tldraw'
import type { CanvasNode, NodeId, Relation, RelationId } from '@/domain'
import { clampGravity, nodeCenter } from '@/domain'
import { isPostItShape } from '@/canvas/shapes/postItShape'
import {
	nodeIdToShapeId,
	relationIdToShapeId,
	shapeIdToNodeId,
	shapeIdToRelationId,
} from '@/canvas/adapter/ids'
import { plainTextToRichText, richTextToPlainText } from '@/canvas/adapter/richText'

export const ARROW_SHAPE_TYPE = 'arrow'

/** The meta key `RelationTool` stamps. Absent means the arrow is decoration. */
export const RELATION_META_KEY = 'relation'

/**
 * Where an arrow's gravity is kept.
 *
 * Flat in `shape.meta`, beside the `relation` flag rather than nested inside it.
 * Nesting would mean `meta.relation` stops being `true`, which is the one value
 * `isRelationArrow` accepts — every arrow already on a canvas would become
 * decoration, and the strictness of that check is worth more than the tidier
 * shape.
 */
export const RELATION_GRAVITY_META_KEY = 'gravity'

/**
 * `shape.meta` is unvalidated JSON — tldraw stores and syncs it but never
 * inspects it — so the flag is read as strictly as every other meta field:
 * `true` and nothing else counts.
 */
export function isRelationArrow(shape: TLShape): boolean {
	return shape.type === ARROW_SHAPE_TYPE && shape.meta?.[RELATION_META_KEY] === true
}

/**
 * The arrow's label, or nothing.
 *
 * Trimmed, and empty means **absent**. A relation with no type says "the user
 * connected these and didn't say why", which is a different claim from one named
 * `""` — and a very different one from `related_to`, which nothing here invents.
 */
export function relationType(arrow: TLShape): string | undefined {
	const props = arrow.props as { richText?: Parameters<typeof richTextToPlainText>[0] }
	const label = richTextToPlainText(props.richText).trim()

	return label === '' ? undefined : label
}

/**
 * How strongly the arrow asserts its relationship. 0–1.
 *
 * Read from meta rather than from geometry, and that is the whole point: the
 * arrow's length, its bend and the distance between its endpoints have no bearing
 * on the number. `clampGravity` supplies the default, so an arrow drawn before
 * this field existed — or one whose meta was hand-edited into nonsense — reads as
 * the full-strength claim that drawing it was.
 */
export function relationGravity(arrow: TLShape): number {
	return clampGravity(arrow.meta?.[RELATION_GRAVITY_META_KEY])
}

/**
 * Every relation on the current page.
 *
 * Derived on read, like `spatialContext`: there is no second store holding
 * relations, so moving a note, redrawing an arrow or undoing all produce a
 * correct document with nothing to invalidate.
 *
 * Takes the already-projected `nodes` so an endpoint can be checked against the
 * canonical model rather than against the store — that is what makes "bound to
 * something that isn't a Node" and "bound to a Node that has since been deleted"
 * the same, correctly handled case.
 */
export function getCanvasRelations(
	editor: Editor,
	nodes: Record<NodeId, CanvasNode>
): Record<RelationId, Relation> {
	const relations: Record<RelationId, Relation> = {}

	for (const shape of editor.getCurrentPageShapes()) {
		if (!isRelationArrow(shape)) continue

		const bindings = editor.getBindingsFromShape<TLArrowBinding>(shape.id, ARROW_SHAPE_TYPE)

		// Both ends have to land on a Node. An arrow with one end loose is not
		// asserting a relationship between two things — it is a half-drawn gesture,
		// and guessing what the user meant to connect it to would be inventing the
		// claim for them.
		const from = boundNodeId(editor, bindings, 'start', nodes)
		const to = boundNodeId(editor, bindings, 'end', nodes)
		if (!from || !to) continue

		// Self-relations are omitted, following `calculateSpatialInfluences`: a node
		// related to itself isn't a relationship that exists.
		if (from === to) continue

		const id = shapeIdToRelationId(shape.id)
		const type = relationType(shape)

		relations[id] = {
			id,
			from,
			to,
			gravity: relationGravity(shape),
			// Spread, so an unlabelled relation has no `type` key at all rather than
			// one set to undefined — the same treatment `contextualField` gets.
			...(type === undefined ? {} : { type }),
		}
	}

	return relations
}

/**
 * Rebuilds relation arrows from canonical JSON. The inverse of
 * `getCanvasRelations`, and the reason a document can restore a whole canvas
 * rather than only its notes.
 *
 * Lives here rather than in the Inspector so it can be tested against a real
 * editor — the same reason `setContextualFieldRadius` does. Returns how many
 * relations were drawn, so a caller can tell "none of them referenced real
 * nodes" from "it worked".
 *
 * **Arrow geometry is not restored**, and can't be: the canonical `Relation`
 * carries no anchor, no bend and no terminal detail by design. An imported arrow
 * therefore binds centre-to-centre and re-routes itself. The *relationship* is
 * exact — direction, label and gravity all survive, because all three are claims
 * rather than draughtsmanship — the same trade as text formatting being lost when
 * a Node is rebuilt from `content.text`.
 */
export function createRelations(
	editor: Editor,
	relations: Record<RelationId, Relation>,
	nodes: Record<NodeId, CanvasNode>
): number {
	const drawable = Object.values(relations).filter(
		(relation) => nodes[relation.from] && nodes[relation.to] && relation.from !== relation.to
	)
	if (!drawable.length) return 0

	const pageId = editor.getCurrentPageId()

	editor.createShapes(
		drawable.map((relation) => {
			const from = nodeCenter(nodes[relation.from])
			const to = nodeCenter(nodes[relation.to])

			return {
				id: relationIdToShapeId(relation.id),
				type: ARROW_SHAPE_TYPE,
				parentId: pageId,
				// Placed at the source centre with the terminals in local coordinates, so
				// the arrow is roughly right the instant it exists. The bindings below
				// then own where it actually lands.
				x: from.x,
				y: from.y,
				props: {
					start: { x: 0, y: 0 },
					end: { x: to.x - from.x, y: to.y - from.y },
					richText: plainTextToRichText(relation.type ?? ''),
				},
				// Explicit, because `getInitialMetaForShape` only tags arrows drawn while
				// the Relation tool is active and an import runs under `select`.
				// `createShapes` merges meta as `{...initial, ...partial}`, so this wins.
				//
				// Clamped on the way in, not trusted: an imported document is typed by
				// assertion only, so this is the boundary that keeps a `gravity` of `7`,
				// `"1"` or nothing at all out of the store.
				meta: {
					[RELATION_META_KEY]: true,
					[RELATION_GRAVITY_META_KEY]: clampGravity(relation.gravity),
				},
			}
		})
	)

	editor.createBindings(
		drawable.flatMap((relation) => {
			const arrowId = relationIdToShapeId(relation.id)

			// `snap` is deliberately omitted so the binding util's own default applies:
			// an imported arrow should route exactly like a drawn one, and hard-coding
			// a value here would make the two diverge if that default ever changes.
			return [
				binding(arrowId, nodeIdToShapeId(relation.from), 'start'),
				binding(arrowId, nodeIdToShapeId(relation.to), 'end'),
			]
		})
	)

	return drawable.length
}

/**
 * Sets the gravity of the given relation arrows.
 *
 * Takes explicit ids rather than reading the current selection, for the reason
 * `setContextualFieldRadius` does: the value is committed when its input loses
 * focus, and the click that moves focus has usually changed the selection first,
 * so "apply to whatever is selected now" would apply it to nothing.
 *
 * The patch carries the gravity key alone. tldraw shallow-merges a meta patch key
 * by key, so `relation: true` survives untouched — writing a whole meta object
 * here would un-tag the arrow and quietly turn a relation into decoration.
 *
 * Returns how many arrows changed, so a caller can tell "none of those were
 * relations" from "it worked".
 */
export function setRelationGravity(editor: Editor, ids: TLShapeId[], gravity: number): number {
	const arrows = ids
		.map((id) => editor.getShape(id))
		.filter((shape) => shape !== undefined)
		.filter(isRelationArrow)

	if (!arrows.length) return 0

	editor.markHistoryStoppingPoint('set relational gravity')
	editor.updateShapes(
		arrows.map((arrow) => ({
			id: arrow.id,
			type: arrow.type,
			meta: { [RELATION_GRAVITY_META_KEY]: clampGravity(gravity) },
		}))
	)

	return arrows.length
}

/** The relation arrows in the current selection, in selection order. */
export function selectedRelationArrowIds(editor: Editor): TLShapeId[] {
	return editor
		.getSelectedShapes()
		.filter(isRelationArrow)
		.map((shape) => shape.id)
}

/** `as const` so `type` keeps its literal type; a widened `string` isn't a binding type. */
function binding(arrowId: TLShapeId, toId: TLShapeId, terminal: 'start' | 'end') {
	return {
		type: ARROW_SHAPE_TYPE,
		fromId: arrowId,
		toId,
		props: {
			terminal,
			normalizedAnchor: { x: 0.5, y: 0.5 },
			isExact: false,
			isPrecise: false,
		},
	} as const
}

/** The canonical NodeId an arrow terminal is bound to, if it is bound to a Node at all. */
function boundNodeId(
	editor: Editor,
	bindings: TLArrowBinding[],
	terminal: 'start' | 'end',
	nodes: Record<NodeId, CanvasNode>
): NodeId | undefined {
	const binding = bindings.find((candidate) => candidate.props.terminal === terminal)
	if (!binding) return undefined

	if (!isNodeShape(editor, binding.toId)) return undefined

	// Checked against the projected nodes, not just the shape type: a post-it that
	// isn't in the document — a different page, or one filtered out — can't be an
	// endpoint of a relation in it.
	const nodeId = shapeIdToNodeId(binding.toId)
	return nodes[nodeId] ? nodeId : undefined
}

function isNodeShape(editor: Editor, id: TLShapeId): boolean {
	const shape = editor.getShape(id)
	return shape !== undefined && isPostItShape(shape)
}
