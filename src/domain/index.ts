export type {
	CanvasId,
	CanvasDocument,
	CanvasMetadata,
	Relation,
	RelationId,
} from '@/domain/canvas'

export type {
	CanvasNode,
	ContextualField,
	CreatePostItNodeOptions,
	NodeContent,
	NodeId,
	NodeMetadata,
	NodeType,
	PostItNode,
	SpatialProperties,
	VisualProperties,
} from '@/domain/node'

export {
	createPostItNode,
	DEFAULT_ORDER,
	POST_IT_DEFAULT_HEIGHT,
	POST_IT_DEFAULT_VISUAL,
	POST_IT_DEFAULT_WIDTH,
} from '@/domain/node'

export type { Point, SpatialContext, SpatialInfluence } from '@/domain/spatialInfluence'

export {
	buildSpatialContext,
	calculateSpatialInfluence,
	calculateSpatialInfluences,
	distanceBetweenNodes,
	nodeCenter,
} from '@/domain/spatialInfluence'
