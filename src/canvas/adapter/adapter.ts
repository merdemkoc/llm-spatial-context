/**
 * The projection between a canonical Node and a tldraw shape.
 *
 * A tldraw shape scatters the canonical Node across four places, and hiding
 * that is most of this module's job:
 *
 *   spatial.x/y/rotation        → base record x, y, rotation
 *   spatial.width/height        → props.w, props.h   (no base-level size exists)
 *   spatial.order               → base record index  (fractional index, verbatim)
 *   visual.opacity              → base record opacity — *not* props; opacity is
 *                                 not a style prop in tldraw
 *   visual.fill/stroke/textColor → props
 *   content.text                → derived from props.richText
 *   metadata.*                  → shape.meta
 *   contextualField             → shape.meta — tldraw has no concept of it, and
 *                                 unlike geometry it can't be derived back out
 *
 * Everything here is pure and free of tldraw runtime imports, so the round-trip
 * invariant can be tested without an editor.
 */
import type { IndexKey, JsonObject, TLShapePartial } from 'tldraw'
import type { CanvasNode, ContextualField, NodeMetadata, PostItNode } from '@/domain'
import { DEFAULT_ORDER } from '@/domain'
import { POST_IT_SHAPE_TYPE, type PostItShape } from '@/canvas/shapes/postItShape'
import { nodeIdToShapeId, shapeIdToNodeId } from '@/canvas/adapter/ids'
import { plainTextToRichText, richTextToPlainText } from '@/canvas/adapter/richText'

/**
 * A shape's position in world coordinates.
 *
 * `shape.x/y/rotation` are *parent-relative*, so they only equal world
 * coordinates while the shape is parented to the page. Call sites that can't
 * guarantee that pass this, decomposed from `editor.getShapePageTransform()`.
 *
 * Note this is not `getShapePageBounds()`, which returns the axis-aligned
 * bounding box of the *rotated* shape — using that would silently break the
 * round trip for any rotated node.
 */
export interface PageTransform {
	x: number
	y: number
	rotation: number
}

const FALLBACK_METADATA: NodeMetadata = {
	createdAt: '1970-01-01T00:00:00.000Z',
	updatedAt: '1970-01-01T00:00:00.000Z',
	createdBy: 'user',
}

/**
 * `shape.meta` is an unvalidated `JsonObject` — tldraw stores and syncs it but
 * never inspects it, and meta validators aren't available on the persistenceKey
 * path — so every field is read defensively.
 */
export function readNodeMeta(meta: JsonObject | undefined): NodeMetadata {
	if (!meta) return { ...FALLBACK_METADATA }

	const createdBy = meta.createdBy
	return {
		createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : FALLBACK_METADATA.createdAt,
		updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : FALLBACK_METADATA.updatedAt,
		createdBy:
			createdBy === 'user' || createdBy === 'agent' || createdBy === 'system'
				? createdBy
				: FALLBACK_METADATA.createdBy,
	}
}

export function writeNodeMeta(metadata: NodeMetadata): JsonObject {
	return {
		createdAt: metadata.createdAt,
		updatedAt: metadata.updatedAt,
		createdBy: metadata.createdBy,
	}
}

/**
 * The contextual field shares `shape.meta` with the timestamps, for the same
 * reason: it's canonical state tldraw itself has no representation for. A shape
 * prop would need a schema migration and a `persistenceKey` bump; meta needs
 * neither, at the cost of being unvalidated — hence the same defensive reads.
 *
 * A radius of `0` or less is kept rather than scrubbed. It's a legitimate state
 * meaning "no reach", and the influence calculation already treats it as such;
 * discarding it here would silently turn it back into "no field at all".
 */
export function readNodeContextualField(meta: JsonObject | undefined): ContextualField | undefined {
	const field = meta?.contextualField
	if (typeof field !== 'object' || field === null || Array.isArray(field)) return undefined

	const radius = (field as JsonObject).radius
	if (typeof radius !== 'number' || !Number.isFinite(radius)) return undefined

	return { radius }
}

/**
 * Spreadable meta for a *new* shape: no key at all when there is no field.
 *
 * `undefined` is not an option here. `shape.meta` is validated as JSON —
 * `T.jsonValue` walks it and rejects any `undefined` it finds — so writing
 * `contextualField: undefined` fails the record validator outright rather than
 * being quietly dropped.
 */
export function writeNodeContextualField(field: ContextualField | undefined): JsonObject {
	return field ? { contextualField: { radius: field.radius } } : {}
}

/**
 * A meta *patch* for a shape that already exists, where clearing has to be
 * expressed rather than implied.
 *
 * Clearing writes `null`, which is the one value that satisfies both
 * constraints: tldraw shallow-merges meta patches key by key, so an omitted key
 * would leave the previous radius in place, and `undefined` would fail JSON
 * validation. `readNodeContextualField` reads `null` back as "no field".
 */
export function contextualFieldPatch(field: ContextualField | undefined): JsonObject {
	return { contextualField: field ? { radius: field.radius } : null }
}

export function shapeToNode(shape: PostItShape, pageTransform?: PageTransform): PostItNode {
	const contextualField = readNodeContextualField(shape.meta)

	return {
		id: shapeIdToNodeId(shape.id),
		type: 'post_it',
		content: {
			text: richTextToPlainText(shape.props.richText),
		},
		spatial: {
			x: pageTransform?.x ?? shape.x,
			y: pageTransform?.y ?? shape.y,
			width: shape.props.w,
			height: shape.props.h,
			rotation: pageTransform?.rotation ?? shape.rotation,
			order: shape.index ?? DEFAULT_ORDER,
		},
		// Spread, so a node without a field has no key rather than `undefined`.
		...(contextualField ? { contextualField } : {}),
		visual: {
			fill: shape.props.fill,
			stroke: shape.props.stroke,
			opacity: shape.opacity,
			textColor: shape.props.textColor,
		},
		metadata: readNodeMeta(shape.meta),
	}
}

/**
 * The inverse projection. Returns a partial rather than a full record so the
 * editor can fill in what it owns (`parentId` is set explicitly at the call
 * site, since a Node's coordinates are always world coordinates).
 */
export function nodeToShape(node: CanvasNode): TLShapePartial<PostItShape> {
	return {
		id: nodeIdToShapeId(node.id),
		type: POST_IT_SHAPE_TYPE,
		x: node.spatial.x,
		y: node.spatial.y,
		rotation: node.spatial.rotation,
		index: node.spatial.order as IndexKey,
		opacity: node.visual.opacity,
		props: {
			w: node.spatial.width,
			h: node.spatial.height,
			richText: plainTextToRichText(node.content.text ?? ''),
			fill: node.visual.fill,
			stroke: node.visual.stroke,
			textColor: node.visual.textColor,
		},
		meta: {
			...writeNodeMeta(node.metadata),
			...writeNodeContextualField(node.contextualField),
		},
	}
}
