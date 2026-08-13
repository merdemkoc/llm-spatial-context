/**
 * What an episode's ids actually refer to.
 *
 * Events name nodes by `NodeId` — a tldraw shape id like `shape:V1StGXR8` — which is all
 * the domain needs and all it should carry. The AI observer needs more: asked to say what a
 * spatial change *means*, with only two opaque ids and a float it can only produce filler.
 * This resolves the ids against the canvas, so the observer talks about the ideas by name.
 *
 * Standing relations come along for the same reason. An arrow drawn ten episodes ago is
 * what makes "you pulled them apart but kept the connection" legible at all — the episode
 * itself only reports that influence fell. Reading them is a canvas concern, so it lives
 * here in the adapter rather than in the pure domain.
 */
import type { Editor } from 'tldraw'
import type { EpisodeSummary, NodeId } from '@/domain'
import type { EpisodeContext, RelationContext } from '@/companion/observerClient'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'

/** Every node id an episode mentions, structural events and pairs alike. */
function involvedNodes(summary: EpisodeSummary): Set<NodeId> {
	const ids = new Set<NodeId>()
	for (const pair of summary.pairs) {
		ids.add(pair.source)
		ids.add(pair.target)
	}
	for (const event of summary.structural) {
		if ('nodeId' in event) ids.add(event.nodeId)
		if ('source' in event) ids.add(event.source)
		if ('target' in event) ids.add(event.target)
		if ('previous' in event && typeof event.previous === 'object' && event.previous !== null) {
			const endpoints = event.previous as { source?: NodeId; target?: NodeId }
			if (endpoints.source) ids.add(endpoints.source)
			if (endpoints.target) ids.add(endpoints.target)
		}
		if ('current' in event && typeof event.current === 'object' && event.current !== null) {
			const endpoints = event.current as { source?: NodeId; target?: NodeId }
			if (endpoints.source) ids.add(endpoints.source)
			if (endpoints.target) ids.add(endpoints.target)
		}
	}
	return ids
}

/**
 * Resolve one episode's context against the live canvas.
 *
 * Labels cover the nodes the episode mentions; relations cover every explicit relation
 * currently touching one of them, whether or not this episode created it.
 */
export function readEpisodeContext(editor: Editor, summary: EpisodeSummary): EpisodeContext {
	const canvas = getCanvasDocument(editor)
	const involved = involvedNodes(summary)

	const labels: Record<NodeId, string> = {}
	for (const id of involved) {
		const text = canvas.nodes[id]?.content.text?.trim()
		if (text) labels[id] = text
	}

	const relations: RelationContext[] = []
	for (const relation of Object.values(canvas.relations)) {
		if (!involved.has(relation.from) && !involved.has(relation.to)) continue
		// Name both ends even when only one is in the episode, so the arrow reads as a whole.
		for (const id of [relation.from, relation.to]) {
			if (labels[id] !== undefined) continue
			const text = canvas.nodes[id]?.content.text?.trim()
			if (text) labels[id] = text
		}
		relations.push({
			source: relation.from,
			target: relation.to,
			gravity: relation.gravity,
			...(relation.type === undefined ? {} : { type: relation.type }),
		})
	}

	return { labels, relations }
}
