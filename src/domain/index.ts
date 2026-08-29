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

export type {
	BoardCluster,
	BoardEffectivePair,
	BoardNodeSummary,
	BoardProximity,
	BoardRelationSummary,
	BoardSummary,
} from '@/domain/boardSummary'

export {
	BOARD_NODE_LIMIT,
	BOARD_PROXIMITY_LIMIT,
	buildBoardSummary,
	CLUSTER_INFLUENCE_THRESHOLD,
} from '@/domain/boardSummary'

export type { ClusterLayoutOptions, ClusterPlacement } from '@/domain/clusterLayout'

export {
	computeClusterLayout,
	DEFAULT_CLUSTER_GAP,
	DEFAULT_CLUSTER_ITERATIONS,
	DEFAULT_CLUSTER_MARGIN,
} from '@/domain/clusterLayout'

export type { IdeaPlacementOptions } from '@/domain/ideaPlacement'

export { DEFAULT_IDEA_GAP, placeNewNotes } from '@/domain/ideaPlacement'

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

export { diffCanvas, roundPoint } from '@/domain/canvasDiff'

export type { PairSnapshot, SpatialEvent } from '@/domain/events'

export { deriveEvents, STRONG_PROXIMITY, WEAK_PROXIMITY } from '@/domain/events'

export type { EventListener, SpatialEventStream } from '@/domain/eventStream'

export { createEventStream, DEFAULT_BUFFER_SIZE, spatialEventStream } from '@/domain/eventStream'

export type {
	EpisodePairChange,
	EpisodeRecorderOptions,
	EpisodeSummary,
	Schedule,
} from '@/domain/episode'

export {
	buildEpisodeSummary,
	createEpisodeRecorder,
	EPISODE_BUFFER_LIMIT,
	EPISODE_IDLE_MS,
	episodeNodes,
	isTrivialEpisode,
	TRIVIAL_INFLUENCE_EPSILON,
} from '@/domain/episode'

export type { IdleBackoff, IdleBackoffOptions } from '@/domain/idleBackoff'

export {
	createIdleBackoff,
	IDLE_BACKOFF_CAP_MS,
	IDLE_BACKOFF_MARGIN_MS,
	IDLE_BACKOFF_STEP_MS,
} from '@/domain/idleBackoff'

export { DRIFT_THRESHOLD, driftOf, driftWeight } from '@/domain/understandingDrift'
