/**
 * The client half of the digest call.
 *
 * A `DigestClient` turns the whole board into the companion's standing understanding of it.
 * The interface is the seam the orchestrator depends on, so a test can substitute a fake and
 * never touch the network; `createHttpDigestClient` is the real one, a thin POST to the server
 * that holds the API key. A sibling of `observerClient`, `suggestClient` and `reflectClient`,
 * down to the abort/timeout handling.
 *
 * The one difference: this answer is *kept*. A half-built understanding would be carried into
 * every later prompt, so a missing field is filled from `EMPTY_UNDERSTANDING` rather than left
 * undefined for a consumer to trip over.
 *
 * `BoardUnderstanding` is declared here as well as in `server/prompting/types.ts` on purpose —
 * the server never imports from `src/`, so the two are loose mirrors of one wire format, the
 * same arrangement `BoardSummary` and `BoardSummaryPayload` already have.
 */
import type { BoardSummary, NodeId } from '@/domain'

/** One theme the board is organised around. */
export interface Theme {
	name: string
	meaning: string
	members: NodeId[]
}

/** What the companion currently understands this board to be. */
export interface BoardUnderstanding {
	themes: Theme[]
	reading: string
	narrative: string
	tensions: string[]
	derivedFromNodes: NodeId[]
}

/** Nothing understood — and the shape every partial reply is filled out to. */
export const EMPTY_UNDERSTANDING: BoardUnderstanding = {
	themes: [],
	reading: '',
	narrative: '',
	tensions: [],
	derivedFromNodes: [],
}

/** What the browser POSTs: the whole board, and what the companion has said this session. */
export interface DigestRequest {
	board: BoardSummary
	recentComments: string[]
}

export interface DigestClient {
	/** Resolve a standing understanding. Honor `signal` if a newer derivation supersedes this. */
	digest(request: DigestRequest, signal?: AbortSignal): Promise<BoardUnderstanding>
}

/**
 * How long to wait for a digest.
 *
 * The reflection's ceiling rather than the observer's: reading the whole board and naming its
 * themes is the same order of work. Nothing is waiting on it, so a slow one costs no felt time.
 */
export const DIGEST_TIMEOUT_MS = 30_000

/** The real client: POST the board to the server proxy and read back the understanding. */
export function createHttpDigestClient(
	endpoint = '/api/digest',
	timeoutMs = DIGEST_TIMEOUT_MS
): DigestClient {
	return {
		async digest(request, signal) {
			const timeout = AbortSignal.timeout(timeoutMs)
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal: combined,
			})
			if (!response.ok) {
				throw new Error(`digest failed: ${response.status}`)
			}

			const data = (await response.json()) as Partial<BoardUnderstanding>
			return {
				themes: Array.isArray(data.themes) ? data.themes : [],
				reading: typeof data.reading === 'string' ? data.reading : '',
				narrative: typeof data.narrative === 'string' ? data.narrative : '',
				tensions: Array.isArray(data.tensions) ? data.tensions : [],
				derivedFromNodes: Array.isArray(data.derivedFromNodes) ? data.derivedFromNodes : [],
			}
		},
	}
}
