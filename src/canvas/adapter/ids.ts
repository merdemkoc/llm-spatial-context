/**
 * Identity mapping between the canonical model and tldraw.
 *
 * The canonical model owns identity. A NodeId is a bare UUID; tldraw's shape id
 * is that same UUID behind a `shape:` prefix. `createShapeId(id)` is literally
 * `` `shape:${id}` ``, so prefixing and stripping are exact inverses and the
 * prefix never appears in canonical JSON.
 *
 * Reimplemented rather than imported so this module stays free of tldraw
 * runtime code — see `postItShape.ts` for why that matters.
 */
import type { TLShapeId } from 'tldraw'
import type { NodeId } from '@/domain'

const SHAPE_ID_PREFIX = 'shape:'

export function nodeIdToShapeId(nodeId: NodeId): TLShapeId {
	return `${SHAPE_ID_PREFIX}${nodeId}` as TLShapeId
}

export function shapeIdToNodeId(shapeId: TLShapeId | string): NodeId {
	return shapeId.startsWith(SHAPE_ID_PREFIX) ? shapeId.slice(SHAPE_ID_PREFIX.length) : shapeId
}

/**
 * Mints a fresh NodeId. Duplicate and paste mint a fresh tldraw shape id, which
 * strips back to a fresh NodeId, so copies never share identity with the
 * original.
 */
export function createNodeId(): NodeId {
	return crypto.randomUUID()
}
