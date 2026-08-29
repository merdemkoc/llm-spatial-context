/**
 * The client half of the reflection call.
 *
 * A `ReflectClient` turns the whole board into a reading of it plus a few new notes to add.
 * The interface is the seam the orchestrator depends on, so a test can substitute a fake and
 * never touch the network; `createHttpReflectClient` is the real one, a thin POST to the server
 * that holds the API key. A sibling of `observerClient` and `suggestClient`.
 */
import type { BoardSummary, NodeId } from '@/domain'

/** One proposed new note: its text, kind, and optionally an existing note it connects to. */
export interface IdeaProposal {
	text: string
	kind: 'idea' | 'question'
	/** An existing note id this new one should connect to with an arrow. */
	connectTo?: NodeId
	/** The label for that connection. */
	connectLabel?: string
}

/** A proposed arrow between two existing notes. */
export interface RelationProposal {
	from: NodeId
	to: NodeId
	label?: string
}

/** The reflection: a spoken reading, notes to add, arrows to draw, and what it is about. */
export interface Reflection {
	comment: string
	ideas: IdeaProposal[]
	/** Arrows to draw between existing notes. */
	relations?: RelationProposal[]
	/** Ids of existing notes the comment references — highlighted while it is spoken. */
	focus?: NodeId[]
}

/** What the browser POSTs: the whole board to reflect on, and how to reflect on it. */
export interface ReflectRequest {
	board: BoardSummary
	/** A change that just happened — present makes the reflection a comment on its impact. */
	recentChange?: string
	/** Which persona/lens to reflect through (e.g. 'critique', 'gap-finder'). */
	persona?: string
}

export interface ReflectClient {
	/** Resolve a reflection. Honor `signal` if a newer request supersedes this one. */
	reflect(request: ReflectRequest, signal?: AbortSignal): Promise<Reflection>
}

/**
 * How long to wait for a reflection. A little longer than the observer's ceiling: reading the
 * whole board and drafting notes is more work than a single remark.
 */
export const REFLECT_TIMEOUT_MS = 30_000

/** The server's raw reply. Validated server-side; the client maps it to a reflection. */
interface ReflectResponse {
	comment?: string
	ideas?: IdeaProposal[]
	relations?: RelationProposal[]
	focus?: NodeId[]
}

/** The real client: POST the board to the server proxy and read back the reflection. */
export function createHttpReflectClient(
	endpoint = '/api/reflect',
	timeoutMs = REFLECT_TIMEOUT_MS
): ReflectClient {
	return {
		async reflect(request, signal) {
			const timeout = AbortSignal.timeout(timeoutMs)
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal: combined,
			})
			if (!response.ok) {
				throw new Error(`reflect failed: ${response.status}`)
			}

			const data = (await response.json()) as ReflectResponse
			return {
				comment: typeof data.comment === 'string' ? data.comment : '',
				ideas: Array.isArray(data.ideas) ? data.ideas : [],
				relations: Array.isArray(data.relations) ? data.relations : [],
				focus: Array.isArray(data.focus) ? data.focus : [],
			}
		},
	}
}
