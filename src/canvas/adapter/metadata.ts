/**
 * Maintains the parts of a canonical Node that can't be derived from geometry.
 *
 * `createdAt`, `updatedAt` and `createdBy` are genuinely stateful, so they live
 * in `shape.meta` — the one field tldraw persists, syncs and undoes but never
 * reads itself.
 */
import type { Editor, TLShape } from 'tldraw'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { RELATION_TOOL_ID } from '@/canvas/shapes/RelationTool'
import { readNodeContextualField, writeNodeMeta } from '@/canvas/adapter/adapter'
import { ARROW_SHAPE_TYPE, RELATION_META_KEY } from '@/canvas/adapter/relations'

/**
 * Creation normally means "this node came into existence now", which is also
 * true of a duplicate or a paste — those get a fresh NodeId, so they must get a
 * fresh `createdAt` rather than inheriting the original's.
 *
 * `Editor#createShapes` merges meta as `{...initial, ...partial.meta}`, so the
 * partial always wins and `getInitialMetaForShape` alone can't enforce that.
 * Restoring a saved document is the one case where the stored timestamps should
 * survive, so it opts out through this flag.
 */
let isRestoringNodes = false

/** Runs `fn` with creation timestamps preserved rather than restamped. */
export function restoringNodes<T>(fn: () => T): T {
	isRestoringNodes = true
	try {
		return fn()
	} finally {
		isRestoringNodes = false
	}
}

export function registerNodeMetadata(editor: Editor): () => void {
	editor.getInitialMetaForShape = (shape) => {
		// An arrow drawn with the Relation tool is a claim; the same arrow drawn with
		// the arrow tool is decoration. Nothing about the shape itself distinguishes
		// them, so the tool in use at creation is what does — read here, at the one
		// moment it is knowable. `getCurrentToolId` reports the root tool, so it says
		// `relation` while the tool's `pointing` child creates the shape.
		if (shape.type === ARROW_SHAPE_TYPE) {
			return editor.getCurrentToolId() === RELATION_TOOL_ID ? { [RELATION_META_KEY]: true } : {}
		}

		if (shape.type !== POST_IT_SHAPE_TYPE) return {}

		const now = new Date().toISOString()
		return writeNodeMeta({ createdAt: now, updatedAt: now, createdBy: 'user' })
	}

	const disposeCreate = editor.sideEffects.registerBeforeCreateHandler('shape', (shape) => {
		if (shape.type !== POST_IT_SHAPE_TYPE || isRestoringNodes) return shape

		const now = new Date().toISOString()
		return { ...shape, meta: { ...shape.meta, createdAt: now, updatedAt: now } }
	})

	const disposeChange = editor.sideEffects.registerBeforeChangeHandler(
		'shape',
		(prev, next, source) => {
			// Remote changes must not restamp: two tabs sharing the persistence
			// key would ping-pong the timestamp forever.
			if (source !== 'user') return next
			if (next.type !== POST_IT_SHAPE_TYPE) return next
			if (!hasCanonicalChange(prev, next)) return next

			return { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } }
		}
	)

	return () => {
		disposeCreate()
		disposeChange()
	}
}

/**
 * Only the fields that reach the canonical Node count as a change. Without this
 * a purely internal record rewrite would bump `updatedAt` and make the model
 * look edited when nothing about it was.
 */
function hasCanonicalChange(prev: TLShape, next: TLShape): boolean {
	if (
		prev.x !== next.x ||
		prev.y !== next.y ||
		prev.rotation !== next.rotation ||
		prev.opacity !== next.opacity ||
		prev.index !== next.index
	) {
		return true
	}

	// The contextual field lives in meta, so editing a radius is a canonical
	// change that isn't visible in the record or the props. Compared field by
	// field rather than as whole meta objects: meta also holds `updatedAt`, and
	// comparing that against itself would make this handler restamp forever.
	if (readNodeContextualField(prev.meta)?.radius !== readNodeContextualField(next.meta)?.radius) {
		return true
	}

	const a = prev.props as Record<string, unknown>
	const b = next.props as Record<string, unknown>
	return (
		a.w !== b.w ||
		a.h !== b.h ||
		a.richText !== b.richText ||
		a.fill !== b.fill ||
		a.stroke !== b.stroke ||
		a.textColor !== b.textColor
	)
}
