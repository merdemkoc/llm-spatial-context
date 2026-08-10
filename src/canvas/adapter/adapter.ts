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
 *
 * Everything here is pure and free of tldraw runtime imports, so the round-trip
 * invariant can be tested without an editor.
 */
import type { IndexKey, JsonObject, TLShapePartial } from 'tldraw'
import type { CanvasNode, NodeMetadata, PostItNode } from '@/domain'
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

export function shapeToNode(shape: PostItShape, pageTransform?: PageTransform): PostItNode {
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
		meta: writeNodeMeta(node.metadata),
	}
}
