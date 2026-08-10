/**
 * The canonical Node model.
 *
 * A Node is any entity that can exist on the canvas. `post_it` is the first
 * concrete type, not the abstraction — future types (image, article, youtube,
 * diagram, agent, view) join the union without the Canvas model changing.
 *
 * Nothing in this directory may import tldraw. The canonical model describes
 * what exists on the canvas; the tldraw shape is a projection of it, built in
 * the adapter layer. ESLint enforces this.
 */

/**
 * Stable identity for a Node. Survives moving, resizing, rotating, editing and
 * visual changes.
 *
 * The canonical model owns the id. The adapter derives tldraw's `shape:<id>`
 * from it, so the `shape:` prefix never appears in canonical JSON.
 */
export type NodeId = string

export type NodeType = 'post_it'

/**
 * Content is deliberately generic at the Node level. Future node types will add
 * their own fields (image source, article URL, agent configuration) alongside
 * `text` rather than replacing it.
 *
 * No semantic interpretation belongs here: no role, importance, category,
 * topic, summary, sentiment. A Node represents what exists, not what an AI
 * thinks it means.
 */
export interface NodeContent {
	text?: string
}

/**
 * Geometry in canvas/world coordinates. Never screen coordinates, and never
 * mixed with viewport state — the camera's center/zoom is a different concept
 * and lives elsewhere.
 */
export interface SpatialProperties {
	/** Left edge of the unrotated box, in world coordinates. */
	x: number
	/** Top edge of the unrotated box, in world coordinates. */
	y: number

	width: number
	height: number

	/**
	 * Radians, clockwise, applied about the unrotated box's top-left corner
	 * (`x`, `y`) rather than its center. This matches the renderer exactly, so
	 * the round trip stays lossless; degrees would introduce conversion drift.
	 */
	rotation: number

	/**
	 * Stacking order. An opaque key that sorts lexicographically — later keys
	 * draw on top. Occlusion is spatial information, so it belongs in the
	 * canonical model, but the value itself carries no meaning beyond its sort
	 * position and should not be parsed.
	 */
	order: string
}

/**
 * Appearance only. Visual properties carry no semantics: yellow does not mean
 * important, red does not mean problem, large does not mean relevant. They are
 * preserved because they may become meaningful later, not interpreted now.
 */
export interface VisualProperties {
	/** CSS colour, e.g. `#FFF59D`. */
	fill: string
	stroke: string

	/** 0–1. */
	opacity: number

	textColor: string
}

export interface NodeMetadata {
	/** ISO 8601. */
	createdAt: string
	/** ISO 8601. */
	updatedAt: string

	createdBy: 'user' | 'agent' | 'system'
}

export interface CanvasNode {
	id: NodeId
	type: NodeType

	content: NodeContent

	spatial: SpatialProperties

	visual: VisualProperties

	metadata: NodeMetadata
}

/**
 * A Post-it is a Node whose type is `post_it`. It is deliberately not a
 * separate domain model — the only thing that distinguishes it is the type tag.
 */
export type PostItNode = CanvasNode & { type: 'post_it' }

export const POST_IT_DEFAULT_WIDTH = 240
export const POST_IT_DEFAULT_HEIGHT = 160

export const POST_IT_DEFAULT_VISUAL: VisualProperties = {
	fill: '#FFF59D',
	stroke: '#000000',
	opacity: 1,
	textColor: '#000000',
}

/**
 * The first, lowest stacking key. Nodes created without an explicit order sort
 * below anything already on the canvas once the adapter assigns a real one.
 */
export const DEFAULT_ORDER = 'a1'

export interface CreatePostItNodeOptions {
	id: NodeId
	x: number
	y: number
	width?: number
	height?: number
	rotation?: number
	order?: string
	text?: string
	visual?: Partial<VisualProperties>
	createdBy?: NodeMetadata['createdBy']
	/** Injectable for deterministic tests. */
	now?: string
}

/**
 * Builds a fully-formed canonical Node. Creation always starts here: the Node
 * exists first, and the tldraw shape is derived from it.
 */
export function createPostItNode(options: CreatePostItNodeOptions): PostItNode {
	const timestamp = options.now ?? new Date().toISOString()

	return {
		id: options.id,
		type: 'post_it',
		content: {
			text: options.text ?? '',
		},
		spatial: {
			x: options.x,
			y: options.y,
			width: options.width ?? POST_IT_DEFAULT_WIDTH,
			height: options.height ?? POST_IT_DEFAULT_HEIGHT,
			rotation: options.rotation ?? 0,
			order: options.order ?? DEFAULT_ORDER,
		},
		visual: {
			...POST_IT_DEFAULT_VISUAL,
			...options.visual,
		},
		metadata: {
			createdAt: timestamp,
			updatedAt: timestamp,
			createdBy: options.createdBy ?? 'user',
		},
	}
}
