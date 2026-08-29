/**
 * The payload shapes the browser POSTs, shared by every agent.
 *
 * Declared here rather than imported from `src/` on purpose: the server stays free of the
 * client's domain types, so the two can move independently and the browser's `BoardSummary`
 * is only ever a loose mirror. Everything is optional — the server reads these, it does not
 * construct them, and a field the client stops sending must degrade rather than throw.
 */

/** One explicit relation that exists right now, whether or not this episode touched it. */
export interface RelationContext {
	source: string
	target: string
	gravity: number
	type?: string
}

/**
 * The whole-board summary the browser ships for context. A loose mirror of the domain's
 * `BoardSummary`.
 */
export interface BoardSummaryPayload {
	nodeCount?: number
	nodes?: { id: string; text?: string; hasField?: boolean }[]
	clusters?: { members?: string[] }[]
	loners?: string[]
	proximities?: { source?: string; target?: string; influence?: number }[]
	relations?: RelationContext[]
	effectiveStrengths?: { source?: string; target?: string; effectiveStrength?: number }[]
	truncated?: boolean
}
