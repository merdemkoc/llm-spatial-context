/**
 * Whether the board still bears an episode out — the reading half.
 *
 * A queued remark waits its turn, and while it waits the canvas keeps moving. Before it is
 * spoken the companion asks whether the change it describes is still there, which means
 * looking at the canvas as it stands now. Looking is a canvas concern, so it lives here;
 * deciding what the answer means is not, so that lives in `thoughtQueue.ts`. The same split,
 * and the same reason, as `readEpisodeContext` and the observer.
 *
 * **Takes a document, not an editor.** `getCanvasDocument` rebuilds the whole thing on every
 * call — every directed pair through `buildSpatialContext`, plus the grounding layer — and the
 * companion already asks for one to build the board summary and another to resolve labels.
 * With several thoughts in flight those reads multiply, so the caller reads once and hands the
 * result to all three.
 *
 * Only what the episode named is copied out. A remark about two notes needs two centres and
 * one influence row, not a document, and keeping it that narrow is what lets the judge be pure.
 */
import {
	episodeNodes,
	roundPoint,
	nodeCenter,
	type CanvasDocument,
	type EpisodeSummary,
	type NodeId,
} from '@/domain'
import { pairKey, type EpisodeValidity } from '@/companion/thoughtQueue'

/** Read the live board in the terms one episode described it in. */
export function readEpisodeValidity(
	canvas: CanvasDocument,
	summary: EpisodeSummary
): EpisodeValidity {
	const involved = episodeNodes(summary)

	const centers: Record<NodeId, { x: number; y: number }> = {}
	const radius: Record<NodeId, number> = {}
	for (const id of involved) {
		const node = canvas.nodes[id]
		if (!node) continue
		// Rounded centres, because that is the frame a `node_moved` event was recorded in.
		// `roundPoint(nodeCenter(...))` is exactly what `diffCanvas` applied on the way in.
		centers[id] = roundPoint(nodeCenter(node))
		const field = node.contextualField?.radius
		if (field !== undefined) radius[id] = field
	}

	// Only the pairs the episode actually reported. `spatialContext.influences` holds every
	// directed pair on the board, which is quadratic and almost all of it irrelevant here.
	const wanted = new Set(summary.pairs.map((pair) => pairKey(pair.source, pair.target)))
	const influence: Record<string, number> = {}
	for (const row of canvas.spatialContext.influences) {
		const key = pairKey(row.source, row.target)
		if (wanted.has(key)) influence[key] = row.influence
	}

	// Relations by id, for an arrow the episode named; and every relation's ends, so a removal
	// can be caught having been drawn again — the new arrow has a new id, so identity alone
	// would report it as still gone.
	const named = new Set(
		summary.structural
			.filter((event) => 'relationId' in event)
			.map((event) => (event as { relationId: string }).relationId)
	)
	const gravity: Record<string, number> = {}
	const relationEnds: { source: NodeId; target: NodeId }[] = []
	for (const relation of Object.values(canvas.relations)) {
		if (named.has(relation.id)) gravity[relation.id] = relation.gravity
		relationEnds.push({ source: relation.from, target: relation.to })
	}

	return { centers, influence, gravity, relationEnds, radius }
}
