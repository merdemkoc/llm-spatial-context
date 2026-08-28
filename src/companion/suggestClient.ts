/**
 * The client half of the suggest call.
 *
 * A `SuggestClient` turns the whole board into a grouping proposal — which ideas to pull
 * together, and why. The interface is the seam the orchestrator depends on, so a test can
 * substitute a fake and never touch the network; `createHttpSuggestClient` is the real one,
 * a thin POST to the server that holds the API key. The reasoning, prompt and model live
 * server-side; the browser ships the board and receives the members.
 *
 * A sibling of `observerClient`, down to the abort/timeout handling.
 */
import type { BoardSummary, NodeId } from '@/domain'

/** What the model returns, resolved for the client: which ideas to cluster, and why. */
export interface GroupingProposal {
	/** The members to pull together. Empty when nothing is worth grouping. */
	members: NodeId[]
	/** One short spoken sentence naming what unites them. Empty when declined. */
	rationale: string
}

/** What the browser POSTs: the whole board, why it is asking, and what it recently said. */
export interface SuggestRequest {
	board: BoardSummary
	/** `demand` is the button; `proactive` is the companion offering unprompted (a higher bar). */
	trigger: 'demand' | 'proactive'
	recentComments: string[]
}

export interface SuggestClient {
	/** Resolve a grouping proposal. Honor `signal` if a newer episode or request supersedes this. */
	suggest(request: SuggestRequest, signal?: AbortSignal): Promise<GroupingProposal>
}

/** How long to wait for a proposal before giving up — mirrors the observer's ceiling. */
export const SUGGEST_TIMEOUT_MS = 20_000

/** The server's raw reply. Validated server-side; the client only maps it to a proposal. */
interface SuggestResponse {
	suggest?: boolean
	members?: NodeId[]
	comment?: string
}

/** The real client: POST the board to the server proxy and read back the proposal. */
export function createHttpSuggestClient(
	endpoint = '/api/suggest',
	timeoutMs = SUGGEST_TIMEOUT_MS
): SuggestClient {
	return {
		async suggest(request, signal) {
			// Abort on either the caller's signal (a newer request) or our own timeout.
			const timeout = AbortSignal.timeout(timeoutMs)
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal: combined,
			})
			if (!response.ok) {
				throw new Error(`suggest failed: ${response.status}`)
			}

			const data = (await response.json()) as SuggestResponse
			// The server already declines weak answers to an empty members list; mirror that here
			// so a `suggest: false` reply reads as "no proposal", not a grouping of nobody.
			return data.suggest === true && Array.isArray(data.members)
				? { members: data.members, rationale: data.comment ?? '' }
				: { members: [], rationale: '' }
		},
	}
}
