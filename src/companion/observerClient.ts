/**
 * The client half of the observer call.
 *
 * An `ObserverClient` turns a finalized episode into the model's decision — speak, and if
 * so what. The interface is the seam the orchestrator depends on, so a test can substitute
 * a fake and never touch the network; `createHttpObserverClient` is the real one, a thin
 * POST to the server that holds the API key. The reasoning, the prompt and the model live
 * server-side; the browser only ships the episode and receives the verdict.
 */
import type { EpisodeSummary } from '@/domain'

/** The model's verdict. `comment` is null when it chose to stay silent (`speak: false`). */
export interface ObserverDecision {
	speak: boolean
	comment: string | null
}

/** What the observer needs: the episode, plus recent comments so it doesn't repeat itself. */
export interface ObserveRequest {
	episode: EpisodeSummary
	recentComments: string[]
}

export interface ObserverClient {
	/** Resolve the model's decision. Reject or honor `signal` if a newer episode supersedes this one. */
	observe(request: ObserveRequest, signal?: AbortSignal): Promise<ObserverDecision>
}

/** The real client: POST the episode to the server proxy and read back the decision. */
export function createHttpObserverClient(endpoint = '/api/observe'): ObserverClient {
	return {
		async observe(request, signal) {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal,
			})
			if (!response.ok) {
				throw new Error(`observe failed: ${response.status}`)
			}
			return (await response.json()) as ObserverDecision
		},
	}
}
