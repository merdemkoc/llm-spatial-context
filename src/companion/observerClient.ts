/**
 * The client half of the observer call.
 *
 * An `ObserverClient` turns a finalized episode into the model's decision — speak, and if
 * so what. The interface is the seam the orchestrator depends on, so a test can substitute
 * a fake and never touch the network; `createHttpObserverClient` is the real one, a thin
 * POST to the server that holds the API key. The reasoning, the prompt and the model live
 * server-side; the browser only ships the episode and receives the verdict.
 */
import type { BoardSummary, EpisodeSummary, NodeId } from '@/domain'
import type { BoardUnderstanding } from '@/companion/digestClient'

/** The model's verdict. `comment` is null when it chose to stay silent (`speak: false`). */
export interface ObserverDecision {
	speak: boolean
	comment: string | null
}

/** One explicit relation that exists right now, whether or not this episode touched it. */
export interface RelationContext {
	source: NodeId
	target: NodeId
	gravity: number
	type?: string
}

/**
 * What the episode's ids actually refer to.
 *
 * Events carry `NodeId`s — tldraw shape ids like `shape:V1StGXR8` — which say nothing
 * about the ideas involved. Without the note text the observer is asked to interpret
 * meaning from two opaque strings and a float. Standing relations matter for the same
 * reason: an arrow kept while two notes are pulled apart is only legible if the observer
 * can see the arrow, and it may have been drawn many episodes ago.
 */
export interface EpisodeContext {
	labels: Record<NodeId, string>
	relations: RelationContext[]
}

/** What the observer needs: the episode, what its ids mean, and what it recently said. */
export interface ObserveRequest {
	episode: EpisodeSummary
	context: EpisodeContext
	recentComments: string[]
	/**
	 * The whole board as background, so a remark can tell whether a moved idea is joining or
	 * leaving a cluster. Optional: the observer reads it if present and works without it.
	 */
	board?: BoardSummary
	/** The companion's standing reading of the board. Absent until the first digest returns. */
	understanding?: BoardUnderstanding
	/** How much the board has drifted since that reading was taken. */
	driftSince?: number
}

export interface ObserverClient {
	/** Resolve the model's decision. Reject or honor `signal` if a newer episode supersedes this one. */
	observe(request: ObserveRequest, signal?: AbortSignal): Promise<ObserverDecision>
}

/**
 * How long to wait for a decision before giving up.
 *
 * Without a ceiling a hung request pins "✦ Agent thinking…" until the next episode
 * happens to take ownership of it, which can be indefinitely on a quiet canvas.
 */
export const OBSERVE_TIMEOUT_MS = 20_000

/** The real client: POST the episode to the server proxy and read back the decision. */
export function createHttpObserverClient(
	endpoint = '/api/observe',
	timeoutMs = OBSERVE_TIMEOUT_MS
): ObserverClient {
	return {
		async observe(request, signal) {
			// Abort on either the caller's signal (a newer episode) or our own timeout.
			const timeout = AbortSignal.timeout(timeoutMs)
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal: combined,
			})
			if (!response.ok) {
				throw new Error(`observe failed: ${response.status}`)
			}
			return (await response.json()) as ObserverDecision
		},
	}
}
