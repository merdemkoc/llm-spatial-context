export type {
	CanvasId,
	CanvasDocument,
	CanvasMetadata,
	Relation,
	RelationId,
} from '@/domain/canvas'

export { clampGravity, DEFAULT_RELATION_GRAVITY } from '@/domain/canvas'

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

export type {
	Grounding,
	GroundedNodeRegion,
	GroundedRelationRegion,
	ImageSize,
	RelationGeometry,
	VisualId,
	WorldBox,
} from '@/domain/grounding'

export type { Point, SpatialContext, SpatialInfluence } from '@/domain/spatialInfluence'

export {
	buildSpatialContext,
	calculateSpatialInfluence,
	calculateSpatialInfluences,
	distanceBetweenNodes,
	DISTANCE_PRECISION,
	INFLUENCE_PRECISION,
	nodeCenter,
} from '@/domain/spatialInfluence'

export type { CombineStrategy, EffectiveStrength, StrategyName } from '@/domain/effectiveStrength'

export {
	buildEffectiveStrengths,
	DEFAULT_STRATEGY,
	INTENT_WEIGHT,
	INTENT_WEIGHTED,
	LIFT,
	PRODUCT,
	STRATEGIES,
} from '@/domain/effectiveStrength'

export type {
	CanvasChange,
	CanvasDiff,
	Delta,
	PairDelta,
	RelationEndpoints,
} from '@/domain/canvasDiff'

export { diffCanvas } from '@/domain/canvasDiff'
