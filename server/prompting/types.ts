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

/** One theme the board is organised around, named by the digest. */
export interface Theme {
	name: string
	meaning: string
	/** The notes this theme is made of. Validated against the real board before use. */
	members: string[]
}

/**
 * What the companion currently understands this board to be.
 *
 * Derived periodically rather than per call, and therefore always a little out of date —
 * which is why every consumer is told how stale it is rather than being handed it as fact.
 */
export interface BoardUnderstanding {
	themes: Theme[]
	/** What this board is about, in one or two sentences. */
	reading: string
	/** What the session has been circling — the arc, not the snapshot. */
	narrative: string
	/** What the board leaves unresolved. */
	tensions: string[]
	/** The notes the reading was taken from, so a consumer can see what it predates. */
	derivedFromNodes: string[]
}
