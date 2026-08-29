# Board Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every agent a standing, periodically re-derived reading of what the board _is_, alongside what just _happened_, and form the response from both.

**Architecture:** A fourth agent (`digest`) produces a `BoardUnderstanding` — themes with real note ids, a reading, a session narrative, open tensions. A free local drift score over events the companion already receives decides when it is stale. The client holds it and ships it in every payload; the server stays a stateless proxy. Every field is optional, so a digest that never ran leaves all three existing agents behaving exactly as they do today.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), Hono, `@anthropic-ai/sdk`, vitest, tldraw 5.

**Spec:** `docs/superpowers/specs/2026-08-29-board-understanding-design.md`

## Global Constraints

- **Tabs, not spaces.** Prettier config is repo-root `.prettierrc`; run `npx prettier --write` on touched files only — `npm run format:check` fails on 12 pre-existing files you must not reformat.
- **Server modules never import from `src/`.** Payload types are re-declared in `server/prompting/types.ts` as loose mirrors. This is deliberate; do not "fix" it with a shared import.
- **Config is read inside functions, never in a module constant.** ESM evaluates prompt modules before `index.ts` calls `process.loadEnvFile()`, so a module constant bakes the default and silently ignores `.env`.
- **Every route fails safe.** A bad body, missing key or rejected request degrades to that agent's own safe answer, never an error at the user.
- **`npm test` must never call a paid API.** `vite.config.ts` includes only `src/**/*.test.{ts,tsx}`; keep `evals/` outside it.
- **Verify with:** `npm run typecheck` (both projects), `npm run lint`, `npm test`. `npm run eval` costs real money — run it only where a task says to.
- **Three spec decisions stand as written** and are easy to change later: digest model defaults to `DIGEST_MODEL ?? OBSERVER_MODEL ?? claude-sonnet-5`; `narrative` does not survive reload; `DRIFT_THRESHOLD = 6` with moves weighted 0.

---

### Task 1: The drift score — a free local staleness gate

Pure domain logic with no dependencies. Deciding _whether_ to spend money must not cost money.

**Files:**

- Create: `src/domain/understandingDrift.ts`
- Create: `src/domain/understandingDrift.test.ts`
- Modify: `src/domain/index.ts` (add exports beside the `@/domain/episode` block, ~line 118)

**Interfaces:**

- Consumes: `SpatialEvent` from `@/domain/events`
- Produces: `DRIFT_THRESHOLD: number`, `driftWeight(event: SpatialEvent): number`, `driftOf(events: SpatialEvent[]): number`

- [ ] **Step 1: Write the failing test**

Create `src/domain/understandingDrift.test.ts`:

```ts
/**
 * When the standing reading has gone stale.
 *
 * The weights encode a claim: meaning changes when content or explicit claims change, not
 * when pixels do. Dragging is the overwhelming majority of events and must score nothing,
 * or the companion re-reads the whole board every time the user tidies up.
 */
import { describe, expect, it } from 'vitest'
import { DRIFT_THRESHOLD, driftOf, driftWeight } from '@/domain/understandingDrift'
import type { SpatialEvent } from '@/domain/events'

const snapshot = { distance: 100, influence: 0.5 }

describe('driftWeight', () => {
	it('weighs new and lost content most heavily', () => {
		expect(driftWeight({ type: 'node_created', nodeId: 'a' })).toBe(3)
		expect(driftWeight({ type: 'node_deleted', nodeId: 'a' })).toBe(3)
	})

	it('weighs an explicit claim made or retracted', () => {
		expect(
			driftWeight({
				type: 'relation_created',
				relationId: 'r',
				source: 'a',
				target: 'b',
				gravity: 0.8,
			})
		).toBe(2)
		expect(
			driftWeight({
				type: 'relation_deleted',
				relationId: 'r',
				source: 'a',
				target: 'b',
				gravity: 0.8,
			})
		).toBe(2)
	})

	it('counts a cluster forming but not one loosening', () => {
		const base = { source: 'a', target: 'b', previous: snapshot, current: snapshot } as const
		expect(driftWeight({ type: 'proximity_changed', level: 'strong', ...base })).toBe(1)
		expect(driftWeight({ type: 'proximity_changed', level: 'weak', ...base })).toBe(0)
	})

	it('scores nothing for moving things around', () => {
		const moved: SpatialEvent = {
			type: 'node_moved',
			nodeId: 'a',
			previous: { x: 0, y: 0 },
			current: { x: 50, y: 50 },
		}
		expect(driftWeight(moved)).toBe(0)
	})

	it('scores nothing for re-weighting a claim already made', () => {
		expect(
			driftWeight({
				type: 'relation_gravity_changed',
				relationId: 'r',
				previous: 0.5,
				current: 0.9,
			})
		).toBe(0)
	})
})

describe('driftOf', () => {
	it('is zero for a drag storm, however long', () => {
		const drags: SpatialEvent[] = Array.from({ length: 200 }, (_, i) => ({
			type: 'node_moved',
			nodeId: `n${i}`,
			previous: { x: 0, y: 0 },
			current: { x: i, y: i },
		}))
		expect(driftOf(drags)).toBe(0)
	})

	it('crosses the threshold on two new notes', () => {
		const added: SpatialEvent[] = [
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'node_created', nodeId: 'b' },
		]
		expect(driftOf(added)).toBeGreaterThanOrEqual(DRIFT_THRESHOLD)
	})

	it('crosses the threshold on a note plus two arrows', () => {
		const mixed: SpatialEvent[] = [
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'relation_created', relationId: 'r1', source: 'a', target: 'b', gravity: 0.5 },
			{ type: 'relation_created', relationId: 'r2', source: 'a', target: 'c', gravity: 0.5 },
		]
		expect(driftOf(mixed)).toBeGreaterThanOrEqual(DRIFT_THRESHOLD)
	})

	it('stays under the threshold for a single new note', () => {
		expect(driftOf([{ type: 'node_created', nodeId: 'a' }])).toBeLessThan(DRIFT_THRESHOLD)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/understandingDrift.test.ts`
Expected: FAIL — `Failed to resolve import "@/domain/understandingDrift"`

- [ ] **Step 3: Write the implementation**

Create `src/domain/understandingDrift.ts`:

```ts
/**
 * How far the board has drifted from the reading the companion currently holds.
 *
 * Deciding whether to spend money must not cost money. `isTrivialEpisode` is the precedent —
 * a pure gate above the model call, because a cap enforced after the request is a display cap
 * and an uncapped bill. This is that shape one level up: it decides when the standing
 * understanding has gone stale enough to be worth re-deriving.
 *
 * The weights encode a claim about where meaning lives. A note created or deleted is content
 * gained or lost; an arrow drawn or removed is a claim made or retracted; a cluster forming is
 * a theme forming. Dragging is none of those — and dragging is the overwhelming majority of
 * events, so it scores nothing. Without that the companion would re-read the whole board every
 * time the user tidied the layout.
 *
 * Pure, no tldraw.
 */
import type { SpatialEvent } from '@/domain/events'

/**
 * The drift at which the standing reading is stale enough to re-derive.
 *
 * Six is two new notes, or a note plus an arrow, or three arrows. Low enough that the reading
 * keeps up with real work; high enough that one stray note does not buy a model call.
 */
export const DRIFT_THRESHOLD = 6

/** What one event does to the reading's freshness. */
export function driftWeight(event: SpatialEvent): number {
	switch (event.type) {
		case 'node_created':
		case 'node_deleted':
			return 3
		case 'relation_created':
		case 'relation_deleted':
		case 'relation_rebound':
			return 2
		case 'proximity_changed':
			// Upward only. A cluster forming is a theme forming; one loosening is the
			// observer's business, not a reason to re-read the whole board.
			return event.level === 'strong' ? 1 : 0
		case 'contextual_field_changed':
			return 1
		default:
			return 0
	}
}

/** The drift a whole episode's worth of events adds. */
export function driftOf(events: SpatialEvent[]): number {
	return events.reduce((total, event) => total + driftWeight(event), 0)
}
```

- [ ] **Step 4: Export from the domain barrel**

In `src/domain/index.ts`, after the `@/domain/idleBackoff` export block, add:

```ts
export { DRIFT_THRESHOLD, driftOf, driftWeight } from '@/domain/understandingDrift'
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/domain/understandingDrift.test.ts && npm run typecheck && npm run lint`
Expected: 9 tests PASS, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/domain/understandingDrift.ts src/domain/understandingDrift.test.ts src/domain/index.ts
git add src/domain/understandingDrift.ts src/domain/understandingDrift.test.ts src/domain/index.ts
git commit -m "feat(domain): score how far the board has drifted from the standing reading"
```

---

### Task 2: The digest agent — prompt, validation, brain, route

The fourth sibling of `observe`/`suggest`/`reflect`. Everything model-facing in `digestPrompt.ts`; the SDK call is a `callStructured` config.

**Files:**

- Modify: `server/prompting/types.ts` (add `Theme`, `BoardUnderstanding`)
- Create: `server/digestPrompt.ts`
- Create: `server/digest.ts`
- Modify: `server/index.ts` (import beside the other three, ~line 30; route beside `/api/reflect`, ~line 66)
- Create: `src/companion/renderDigest.test.ts`

**Interfaces:**

- Consumes: `callStructured` from `server/prompting/callStructured.ts`; `CANVAS_PRIMER` from `server/prompting/fragments.ts`; `isCleanRemark` from `server/prompting/remark.ts`; `boardLabels`, `named`, `renderBoardBlocks`, `renderRecentComments` from `server/prompting/boardRender.ts`
- Produces: `BoardUnderstanding`, `Theme`, `NO_UNDERSTANDING`, `MAX_THEMES = 5`, `MAX_TENSIONS = 3`, `digestModel()`, `DIGEST_SYSTEM_PROMPT`, `DIGEST_SCHEMA`, `renderDigestRequest(payload: DigestPayload): string`, `interpretUnderstanding(text: string, board?: BoardSummaryPayload): BoardUnderstanding`, `digest(payload: DigestPayload): Promise<BoardUnderstanding>`

- [ ] **Step 1: Add the shared types**

Append to `server/prompting/types.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `src/companion/renderDigest.test.ts`:

```ts
/**
 * What the digest reads, and how its answer is trusted.
 *
 * The digest is the only agent whose output is not spoken but *stored*, then injected into
 * every other agent — so a hallucinated theme does not embarrass one remark, it poisons every
 * remark until the next derivation. `interpretUnderstanding` is correspondingly strict.
 *
 * The module lives in `server/`, which Vite's `@` alias does not cover, so it is imported by
 * relative path, like `renderEpisode`.
 */
import { describe, expect, it } from 'vitest'
import {
	DIGEST_SYSTEM_PROMPT,
	interpretUnderstanding,
	MAX_TENSIONS,
	MAX_THEMES,
	NO_UNDERSTANDING,
	renderDigestRequest,
} from '../../server/digestPrompt.ts'

const board = {
	nodeCount: 4,
	nodes: [
		{ id: 'a', text: 'pricing is the blocker' },
		{ id: 'b', text: 'SSO keeps coming up in calls' },
		{ id: 'c', text: 'onboarding friction' },
		{ id: 'd', text: 'activation email sequence' },
	],
	clusters: [{ members: ['c', 'd'] }],
	loners: ['a', 'b'],
	proximities: [{ source: 'c', target: 'd', influence: 0.7 }],
	relations: [{ source: 'a', target: 'b', gravity: 0.8, type: 'blocks' }],
	effectiveStrengths: [{ source: 'c', target: 'd', effectiveStrength: 0.7 }],
	truncated: false,
}

const ok = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		themes: [
			{ name: 'Deal friction', meaning: 'What stalls enterprise deals', members: ['a', 'b'] },
		],
		reading: 'A board about why deals stall.',
		narrative: 'Started at pricing, kept returning to SSO.',
		tensions: ['Nothing says whether onboarding causes churn or follows it.'],
		...over,
	})

describe('DIGEST_SYSTEM_PROMPT', () => {
	it('explains the canvas, like every other agent', () => {
		expect(DIGEST_SYSTEM_PROMPT).toContain('"influence"')
		expect(DIGEST_SYSTEM_PROMPT).toContain('"gravity"')
	})
})

describe('renderDigestRequest', () => {
	it('gives the model every note in full with its id', () => {
		const rendered = renderDigestRequest({ board })
		expect(rendered).toContain('pricing is the blocker')
		expect(rendered).toContain('[a]')
	})

	it('passes the session transcript so the narrative is about the arc', () => {
		const rendered = renderDigestRequest({ board, recentComments: ['Those two converged.'] })
		expect(rendered).toContain('Those two converged.')
	})

	it('renders an empty board without throwing', () => {
		expect(() => renderDigestRequest({})).not.toThrow()
	})
})

describe('interpretUnderstanding', () => {
	it('keeps a well-formed reading', () => {
		const result = interpretUnderstanding(ok(), board)
		expect(result.themes).toHaveLength(1)
		expect(result.themes[0].members).toEqual(['a', 'b'])
		expect(result.reading).toBe('A board about why deals stall.')
		expect(result.narrative).toBe('Started at pricing, kept returning to SSO.')
		expect(result.tensions).toHaveLength(1)
	})

	it('records which notes the reading was taken from', () => {
		expect(interpretUnderstanding(ok(), board).derivedFromNodes).toEqual(['a', 'b', 'c', 'd'])
	})

	it('drops a theme naming notes that do not exist', () => {
		const themes = [{ name: 'Ghosts', meaning: 'Not real', members: ['zz', 'yy'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes).toEqual([])
	})

	it('drops a theme left with fewer than two real members', () => {
		const themes = [{ name: 'Lonely', meaning: 'One idea', members: ['a', 'zz'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes).toEqual([])
	})

	it('dedupes repeated members', () => {
		const themes = [{ name: 'Dupes', meaning: 'Same twice', members: ['a', 'a', 'b'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes[0].members).toEqual(['a', 'b'])
	})

	it('caps the number of themes', () => {
		const themes = Array.from({ length: MAX_THEMES + 3 }, (_, i) => ({
			name: `T${i}`,
			meaning: 'x',
			members: ['a', 'b'],
		}))
		expect(interpretUnderstanding(ok({ themes }), board).themes).toHaveLength(MAX_THEMES)
	})

	it('caps the number of tensions', () => {
		const tensions = Array.from({ length: MAX_TENSIONS + 3 }, (_, i) => `tension ${i}`)
		expect(interpretUnderstanding(ok({ tensions }), board).tensions).toHaveLength(MAX_TENSIONS)
	})

	it('blanks prose that leaked scaffolding rather than storing it', () => {
		const result = interpretUnderstanding(ok({ reading: 'A board.}  Actually: {' }), board)
		expect(result.reading).toBe('')
		// The rest of the reading survives — one bad field is not a bad digest.
		expect(result.narrative).not.toBe('')
	})

	it('drops a theme whose name leaked scaffolding', () => {
		const themes = [{ name: 'Deal friction}  {', meaning: 'x', members: ['a', 'b'] }]
		expect(interpretUnderstanding(ok({ themes }), board).themes).toEqual([])
	})

	it('returns nothing understood rather than throwing on unparseable output', () => {
		expect(interpretUnderstanding('not json', board)).toEqual(NO_UNDERSTANDING)
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/companion/renderDigest.test.ts`
Expected: FAIL — cannot resolve `../../server/digestPrompt.ts`

- [ ] **Step 4: Write `digestPrompt.ts`**

Create `server/digestPrompt.ts`:

```ts
/**
 * How the digest is asked, and how its answer is trusted.
 *
 * The observer reacts to a change, the suggester proposes a grouping, the reflection speaks a
 * reading to the user. The digest speaks to nobody: it reads the whole board and produces the
 * standing understanding the other three are given as context.
 *
 * That makes it the one agent whose mistakes compound. A hallucinated theme does not embarrass
 * a single remark — it is stored, and it colours every remark until the next derivation. So it
 * validates harder than its siblings: themes must name notes that exist, a theme of one is not
 * a theme, and any free text that reads as spillage is dropped rather than kept.
 *
 * Config is read inside functions, never a module constant, like `prompt.ts`.
 */
import {
	boardLabels,
	named,
	renderBoardBlocks,
	renderRecentComments,
} from './prompting/boardRender.ts'
import { CANVAS_PRIMER } from './prompting/fragments.ts'
import { isCleanRemark } from './prompting/remark.ts'
import type { BoardSummaryPayload, BoardUnderstanding, Theme } from './prompting/types.ts'

export type { BoardUnderstanding, Theme } from './prompting/types.ts'

/** Most themes one reading may name. Past this it is a list, not an understanding. */
export const MAX_THEMES = 5

/** Most open tensions one reading may name. */
export const MAX_TENSIONS = 3

/** The digest model. Its own env var, falling back to the observer's, then the default. */
export function digestModel(): string {
	return process.env.DIGEST_MODEL ?? process.env.OBSERVER_MODEL ?? 'claude-sonnet-5'
}

/** Nothing understood. The safe answer whenever a response can't be trusted. */
export const NO_UNDERSTANDING: BoardUnderstanding = {
	themes: [],
	reading: '',
	narrative: '',
	tensions: [],
	derivedFromNodes: [],
}

/** What the browser POSTs to `/api/digest`. Loosely typed — the server only reads it. */
export interface DigestPayload {
	board?: BoardSummaryPayload
	/** What the companion has said this session, so the narrative is the arc and not the snapshot. */
	recentComments?: string[]
}

/** The digest's whole character, in one place. */
export const DIGEST_SYSTEM_PROMPT = `You are the memory of a thinking companion that watches someone arrange ideas on a spatial canvas.

${CANVAS_PRIMER}

You are not speaking to the user. Nothing you write is read aloud. Your job is to produce the companion's standing understanding of this board, which its other voices are given as background before they decide what to say. Write for them, not for the person at the canvas.

Produce four things:

- THEMES: the two to five groupings this board is actually organised around. Name each in a few words, say in one line what it means, and list the exact ids of the notes in it. A theme needs at least two notes. Group by what the ideas are about, not merely by what sits close — proximity is evidence, not the answer.
- READING: what this board is about as a whole, in one or two plain sentences.
- NARRATIVE: what the session has been circling, judged from what the companion has recently said. Where the thinking started, where it has gone, what it keeps returning to. If there is no history to read, leave this empty rather than inventing an arc.
- TENSIONS: up to three things the board leaves unresolved — a contradiction, a gap, something asserted but unsupported. Leave this empty rather than manufacturing doubt.

Name ideas by their text. Be concrete and specific to this board: a reading that would fit any board is worth nothing. Use the exact ids given in brackets when you list a theme's members.`

/** The shape the model must return. Array lengths are enforced in code, not the schema. */
export const DIGEST_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['themes', 'reading', 'narrative', 'tensions'],
	properties: {
		themes: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'meaning', 'members'],
				properties: {
					name: { type: 'string', description: 'A few words naming the theme.' },
					meaning: { type: 'string', description: 'One line on what unites these ideas.' },
					members: {
						type: 'array',
						items: { type: 'string' },
						description: 'The exact ids of the notes in this theme. At least two.',
					},
				},
			},
			description: 'The groupings this board is organised around. Empty if none are clear.',
		},
		reading: {
			type: 'string',
			description: 'What this board is about as a whole, in one or two plain sentences.',
		},
		narrative: {
			type: 'string',
			description: 'What the session has been circling. Empty when there is no history to read.',
		},
		tensions: {
			type: 'array',
			items: { type: 'string' },
			description: 'What the board leaves unresolved. Empty when nothing clearly does.',
		},
	},
} as const

/** Render the digest request as the user message: the whole board, plus what has been said. */
export function renderDigestRequest(payload: DigestPayload): string {
	const board = payload.board ?? {}
	const nodes = board.nodes ?? []
	const labels = boardLabels(board)

	const lines: string[] = [
		'Here is the whole board, to be read as a standing understanding.',
		'',
		"Ideas on the canvas (use the exact id in brackets when you list a theme's members):",
	]
	for (const node of nodes) lines.push(`- ${named(node.id, labels)} [${node.id}]`)
	lines.push('')

	for (const line of renderBoardBlocks(board, labels, {
		clusterHeading: 'Already sitting together:',
		relationHeading: 'Explicit connections:',
		relationGravity: true,
		proximityHeading: 'Notably close:',
		effectiveHeading: 'Strongest combined links:',
	})) {
		lines.push(line)
	}

	for (const line of renderRecentComments(
		payload.recentComments ?? [],
		'What the companion has said this session, in order — read the arc from it:'
	)) {
		lines.push(line)
	}

	lines.push(
		'Return the themes, the reading, the narrative and the tensions. Leave a field empty rather than filling it with something that would fit any board.'
	)
	return lines.join('\n')
}

/** Keep a free-text field only if it reads as prose rather than as spillage. */
function cleanText(value: unknown): string {
	const text = typeof value === 'string' ? value.trim() : ''
	return text !== '' && isCleanRemark(text) ? text : ''
}

/**
 * Parse and validate the model's answer.
 *
 * Structured output guarantees the four fields exist. It does not guarantee that a theme names
 * real notes, that a theme has more than one member, or that the prose is prose. All three are
 * enforced here, because this answer is stored and reused rather than spoken once.
 */
export function interpretUnderstanding(
	text: string,
	board?: BoardSummaryPayload
): BoardUnderstanding {
	let parsed: { themes?: unknown; reading?: unknown; narrative?: unknown; tensions?: unknown }
	try {
		parsed = JSON.parse(text)
	} catch {
		console.warn('[digest] structured output did not parse')
		return NO_UNDERSTANDING
	}

	const known = new Set((board?.nodes ?? []).map((node) => node.id))

	const rawThemes = Array.isArray(parsed.themes) ? parsed.themes : []
	const themes: Theme[] = rawThemes
		.map((entry): Theme | null => {
			const name = cleanText(entry?.name)
			const meaning = cleanText(entry?.meaning)
			if (name === '') return null
			const members = Array.isArray(entry?.members)
				? [
						...new Set(
							entry.members.filter(
								(id: unknown): id is string => typeof id === 'string' && known.has(id)
							)
						),
					]
				: []
			// A theme of one is not a theme, and a theme of nobody is a hallucination.
			return members.length >= 2 ? { name, meaning, members } : null
		})
		.filter((theme): theme is Theme => theme !== null)
		.slice(0, MAX_THEMES)

	const tensions = (Array.isArray(parsed.tensions) ? parsed.tensions : [])
		.map(cleanText)
		.filter((tension: string) => tension !== '')
		.slice(0, MAX_TENSIONS)

	return {
		themes,
		reading: cleanText(parsed.reading),
		narrative: cleanText(parsed.narrative),
		tensions,
		derivedFromNodes: [...known],
	}
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/companion/renderDigest.test.ts`
Expected: 14 tests PASS.

- [ ] **Step 6: Write the brain and the route**

Create `server/digest.ts`:

```ts
/**
 * The digest endpoint's brain: the whole board in, a standing understanding out.
 *
 * A fourth sibling of `observe.ts`, `suggest.ts` and `reflect.ts`, sharing their asking
 * (`prompting/callStructured.ts`). Its answer is stored by the client and injected into the
 * other three, so an untrustworthy one degrades to nothing understood rather than to a wrong
 * understanding held with confidence.
 */
import { callStructured } from './prompting/callStructured.ts'
import {
	DIGEST_SCHEMA,
	DIGEST_SYSTEM_PROMPT,
	digestModel,
	interpretUnderstanding,
	NO_UNDERSTANDING,
	renderDigestRequest,
	type BoardUnderstanding,
	type DigestPayload,
} from './digestPrompt.ts'

export async function digest(payload: DigestPayload): Promise<BoardUnderstanding> {
	return callStructured({
		tag: 'digest',
		model: digestModel(),
		system: DIGEST_SYSTEM_PROMPT,
		schema: DIGEST_SCHEMA,
		user: renderDigestRequest(payload),
		interpret: (text) => interpretUnderstanding(text, payload.board),
		fallback: NO_UNDERSTANDING,
	})
}
```

In `server/index.ts`, add beside the other three dynamic imports:

```ts
const { digest } = await import('./digest.ts')
```

and beside the `/api/reflect` route:

```ts
app.post('/api/digest', limit, async (c) => {
	try {
		const payload = await c.req.json()
		return c.json(await digest(payload))
	} catch (error) {
		console.error('[digest] failed:', error)
		// Fail safe, like the other routes: a broken digest is nothing understood, which the
		// client keeps out of every prompt rather than injecting as fact.
		return c.json({ themes: [], reading: '', narrative: '', tensions: [], derivedFromNodes: [] })
	}
})
```

- [ ] **Step 7: Verify the route end to end**

```bash
PORT=8791 npx tsx server/index.ts & sleep 4
curl -s -X POST localhost:8791/api/digest -H 'content-type: application/json' \
  -d '{"board":{"nodeCount":3,"nodes":[{"id":"a","text":"pricing is the blocker"},{"id":"b","text":"SSO keeps coming up"},{"id":"c","text":"onboarding friction"}],"clusters":[],"loners":["a","b","c"],"proximities":[],"relations":[],"effectiveStrengths":[],"truncated":false}}'
kill %1
```

Expected: JSON with a non-empty `reading`, and every id in every `themes[].members` drawn from `a`/`b`/`c`.

- [ ] **Step 8: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test
npx prettier --write server/digestPrompt.ts server/digest.ts server/index.ts server/prompting/types.ts src/companion/renderDigest.test.ts
git add server/digestPrompt.ts server/digest.ts server/index.ts server/prompting/types.ts src/companion/renderDigest.test.ts
git commit -m "feat(server): add the digest agent that reads the board's standing understanding"
```

---

### Task 3: Inject the understanding into the three existing agents

The prompt engineering. One shared renderer so all three phrase it identically, and one shared fragment so all three apply the same triage.

**Files:**

- Create: `server/prompting/understanding.ts`
- Modify: `server/prompting/fragments.ts` (add `UNDERSTANDING_TRIAGE`)
- Modify: `server/prompt.ts`, `server/suggestPrompt.ts`, `server/reflectPrompt.ts`
- Modify: `src/companion/renderEpisode.test.ts`, `src/companion/renderSuggest.test.ts`, `src/companion/renderReflect.test.ts`

**Interfaces:**

- Consumes: `BoardUnderstanding` from `server/prompting/types.ts`
- Produces: `renderUnderstanding(understanding: BoardUnderstanding | undefined, driftSince: number | undefined): string[]`, `UNDERSTANDING_TRIAGE: string`. Each of `EpisodePayload`, `SuggestPayload`, `ReflectPayload` gains `understanding?: BoardUnderstanding` and `driftSince?: number`.

- [ ] **Step 1: Write the failing test**

Append to `src/companion/renderEpisode.test.ts`:

```ts
const understanding = {
	themes: [{ name: 'Deal friction', meaning: 'What stalls enterprise deals', members: ['a', 'b'] }],
	reading: 'A board about why deals stall.',
	narrative: 'Started at pricing, kept returning to SSO.',
	tensions: ['Nothing says whether onboarding causes churn or follows it.'],
	derivedFromNodes: ['a', 'b'],
}

describe('renderEpisode with a standing understanding', () => {
	it('states the themes, the reading, the narrative and the tensions', () => {
		const rendered = renderEpisode({ episode: { structural: [], pairs: [] }, understanding })
		expect(rendered).toContain('Deal friction')
		expect(rendered).toContain('A board about why deals stall.')
		expect(rendered).toContain('Started at pricing, kept returning to SSO.')
		expect(rendered).toContain('Nothing says whether onboarding causes churn or follows it.')
	})

	it('says how stale the reading is, so the model can discount it', () => {
		const rendered = renderEpisode({
			episode: { structural: [], pairs: [] },
			understanding,
			driftSince: 8,
		})
		expect(rendered).toMatch(/8 changes ago/)
	})

	it('omits the section entirely when there is no understanding', () => {
		const rendered = renderEpisode({ episode: { structural: [], pairs: [] } })
		expect(rendered).not.toContain('understood this board to be')
	})

	it('places the understanding after the change, so the change stays the subject', () => {
		const rendered = renderEpisode({
			episode: { structural: [{ type: 'node_moved', nodeId: 'a' }], pairs: [] },
			context: { labels: { a: 'pricing is the blocker' }, relations: [] },
			understanding,
		})
		expect(rendered.indexOf('What the user did')).toBeLessThan(rendered.indexOf('Deal friction'))
	})
})

describe('SYSTEM_PROMPT understanding triage', () => {
	it('tells the observer how to judge a change against the standing reading', () => {
		expect(SYSTEM_PROMPT).toContain('FITS')
		expect(SYSTEM_PROMPT).toContain('EXTENDS')
		expect(SYSTEM_PROMPT).toContain('CONTRADICTS')
	})

	it('forbids narrating the understanding back', () => {
		expect(SYSTEM_PROMPT).toContain('never itself a reason to speak')
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/companion/renderEpisode.test.ts`
Expected: FAIL — the understanding text is absent from the rendered output.

- [ ] **Step 3: Add the triage fragment**

Append to `server/prompting/fragments.ts`:

```ts
/**
 * How to judge what just happened against what was already understood.
 *
 * Not more context — a decision procedure, and it inherits the app's own idea. `CANVAS_PRIMER`
 * already tells every agent that when proximity and an explicit relation disagree, that is
 * information rather than a mistake. The same move applies one level up: when the standing
 * understanding disagrees with what just happened, that gap is the most interesting thing on
 * the board.
 *
 * The last line is the guard the board summary already needed. Without it the model narrates
 * the themes back at the user instead of using them.
 */
export const UNDERSTANDING_TRIAGE = `You are also given a standing understanding of this board — its themes, what the session has been circling, and the tensions it leaves open. It was derived earlier and may be out of date. Treat it as your own prior reading, not as current truth.

Judge what just happened against it:
- The change FITS the understanding — it is already accounted for. Usually stay silent.
- The change EXTENDS it — it names something the understanding does not yet hold. Worth a word if the addition is real.
- The change CONTRADICTS it — the board is no longer what you understood it to be. This is the most worth saying, and naming what changed about the whole beats describing the move.

A standing understanding is never itself a reason to speak. Do not summarize it, list its themes, or remark on parts of the board this change did not touch.`
```

- [ ] **Step 4: Write the shared renderer**

Create `server/prompting/understanding.ts`:

```ts
/**
 * The standing understanding, written for a model.
 *
 * One renderer for all three consumers, so they are given the same reading in the same words —
 * the whole point of deriving it once is that the agents stop each inventing their own.
 *
 * Staleness is stated, not merely tracked. A model told its context is old discounts it
 * correctly; a model shown stale context as fact does not, and this reading is out of date by
 * construction — it is derived every few changes, not every call.
 */
import type { BoardUnderstanding } from './types.ts'

/** How the reading's age is phrased. Drift, not seconds: changes are what makes it wrong. */
function staleness(driftSince: number | undefined): string {
	if (driftSince === undefined || driftSince <= 0) return 'It is current as of the change above.'
	return `It was taken ${driftSince} ${driftSince === 1 ? 'change' : 'changes'} ago, so parts of it may already be wrong.`
}

/** The understanding as background lines, or nothing at all when there is none. */
export function renderUnderstanding(
	understanding: BoardUnderstanding | undefined,
	driftSince: number | undefined
): string[] {
	if (!understanding) return []
	const { themes, reading, narrative, tensions } = understanding
	// An understanding with nothing in it is not context, it is noise.
	if (themes.length === 0 && reading === '' && narrative === '' && tensions.length === 0) return []

	const lines: string[] = [`What you understood this board to be. ${staleness(driftSince)}`]

	if (reading !== '') lines.push(`- In short: ${reading}`)
	for (const theme of themes) {
		const meaning = theme.meaning === '' ? '' : ` — ${theme.meaning}`
		lines.push(`- Theme "${theme.name}"${meaning}`)
	}
	if (narrative !== '') lines.push(`- The session so far: ${narrative}`)
	for (const tension of tensions) lines.push(`- Still unresolved: ${tension}`)

	lines.push('')
	return lines
}
```

Note the themes render _without_ their member ids: the ids are what the client validates against, not what the model needs to read. Naming the theme is enough for a remark, and listing ids invites the model to echo them.

- [ ] **Step 5: Wire it into the observer**

In `server/prompt.ts`:

1. Extend the imports:

```ts
import { CANVAS_PRIMER, UNDERSTANDING_TRIAGE } from './prompting/fragments.ts'
import { renderUnderstanding } from './prompting/understanding.ts'
import type { BoardSummaryPayload, BoardUnderstanding, RelationContext } from './prompting/types.ts'
```

2. Add `${UNDERSTANDING_TRIAGE}` to `SYSTEM_PROMPT`, immediately before the final `Return the structured decision:` paragraph.

3. Extend `EpisodePayload`:

```ts
	/** The companion's standing reading of this board. Absent until the first digest runs. */
	understanding?: BoardUnderstanding
	/** How much the board has drifted since that reading was taken. */
	driftSince?: number
```

4. In `renderEpisode`, immediately after the `if (board) { ... }` block and before the recent-comments block:

```ts
// After the change and the board, because it is the most background of the three: the
// setting the setting sits in. Leading with it would make the reading the subject.
for (const line of renderUnderstanding(payload.understanding, payload.driftSince)) {
	lines.push(line)
}
```

- [ ] **Step 6: Wire it into the suggester and the reflection**

In `server/suggestPrompt.ts` and `server/reflectPrompt.ts`, make the same four changes: import `UNDERSTANDING_TRIAGE` and `renderUnderstanding`, add `${UNDERSTANDING_TRIAGE}` before each system prompt's final instruction paragraph, add the two optional payload fields, and push `renderUnderstanding(payload.understanding, payload.driftSince)` immediately before each renderer's recent-comments block.

- [ ] **Step 7: Add the matching tests for the other two**

Append to `src/companion/renderSuggest.test.ts`:

```ts
describe('renderSuggestRequest with a standing understanding', () => {
	it('states the themes it already believes in, so it does not re-propose them', () => {
		const rendered = renderSuggestRequest({
			board,
			understanding: {
				themes: [{ name: 'Deal friction', meaning: 'What stalls deals', members: ['a', 'b'] }],
				reading: 'A board about why deals stall.',
				narrative: '',
				tensions: [],
				derivedFromNodes: ['a', 'b'],
			},
		})
		expect(rendered).toContain('Deal friction')
	})

	it('omits the section when there is no understanding', () => {
		expect(renderSuggestRequest({ board })).not.toContain('understood this board to be')
	})
})
```

Append the equivalent to `src/companion/renderReflect.test.ts`, calling `renderReflection({ board, persona: 'critique', understanding })` and asserting the same two things.

- [ ] **Step 8: Run everything and commit**

```bash
npm run typecheck && npm run lint && npm test
npx prettier --write server/prompting/understanding.ts server/prompting/fragments.ts server/prompt.ts server/suggestPrompt.ts server/reflectPrompt.ts src/companion/renderEpisode.test.ts src/companion/renderSuggest.test.ts src/companion/renderReflect.test.ts
git add -A server/ src/companion/
git commit -m "feat(server): judge each change against the standing understanding"
```

---

### Task 4: The digest client

**Files:**

- Create: `src/companion/digestClient.ts`
- Create: `src/companion/digestClient.test.ts`

**Interfaces:**

- Consumes: `BoardSummary`, `NodeId` from `@/domain`
- Produces: `DigestClient` (with `digest(request: DigestRequest, signal?: AbortSignal): Promise<BoardUnderstanding>`), `DigestRequest`, `BoardUnderstanding`, `Theme`, `createHttpDigestClient(endpoint?: string, timeoutMs?: number): DigestClient`, `DIGEST_TIMEOUT_MS = 30_000`, `EMPTY_UNDERSTANDING`

- [ ] **Step 1: Write the failing test**

Create `src/companion/digestClient.test.ts`:

```ts
/**
 * The client half of the digest call.
 *
 * Unlike its siblings the answer here is stored rather than spoken, so a failed or malformed
 * reply must resolve to nothing understood rather than to a partial understanding the
 * companion would then carry around as fact.
 */
import { describe, expect, it, vi } from 'vitest'
import { createHttpDigestClient, EMPTY_UNDERSTANDING } from '@/companion/digestClient'

const board = {
	nodeCount: 0,
	nodes: [],
	clusters: [],
	loners: [],
	proximities: [],
	relations: [],
	effectiveStrengths: [],
	truncated: false,
}

function respondWith(body: unknown, ok = true) {
	return vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response)
}

describe('createHttpDigestClient', () => {
	it('posts the board and returns the understanding', async () => {
		const fetchMock = respondWith({
			themes: [{ name: 'Deal friction', meaning: 'x', members: ['a', 'b'] }],
			reading: 'A board about why deals stall.',
			narrative: '',
			tensions: [],
			derivedFromNodes: ['a', 'b'],
		})
		vi.stubGlobal('fetch', fetchMock)

		const result = await createHttpDigestClient().digest({ board, recentComments: [] })

		expect(fetchMock).toHaveBeenCalledOnce()
		expect(result.reading).toBe('A board about why deals stall.')
		expect(result.themes).toHaveLength(1)
		vi.unstubAllGlobals()
	})

	it('throws on a failed request rather than inventing an understanding', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response))
		await expect(createHttpDigestClient().digest({ board, recentComments: [] })).rejects.toThrow(
			'digest failed: 502'
		)
		vi.unstubAllGlobals()
	})

	it('fills missing fields rather than returning a half-built understanding', async () => {
		vi.stubGlobal('fetch', respondWith({ reading: 'Just a reading.' }))
		const result = await createHttpDigestClient().digest({ board, recentComments: [] })
		expect(result).toEqual({ ...EMPTY_UNDERSTANDING, reading: 'Just a reading.' })
		vi.unstubAllGlobals()
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/companion/digestClient.test.ts`
Expected: FAIL — cannot resolve `@/companion/digestClient`.

- [ ] **Step 3: Write the client**

Create `src/companion/digestClient.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/companion/digestClient.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/companion/digestClient.ts src/companion/digestClient.test.ts
git add src/companion/digestClient.ts src/companion/digestClient.test.ts
git commit -m "feat(companion): add the digest client"
```

---

### Task 5: Wire the companion — accumulate drift, derive in the background, ship the understanding

**Files:**

- Modify: `src/companion/companion.ts`
- Modify: `src/companion/companionState.ts`
- Modify: `src/companion/observerClient.ts`, `src/companion/suggestClient.ts`, `src/companion/reflectClient.ts` (each request gains two optional fields)
- Modify: `src/canvas/Canvas.tsx`
- Modify: `src/companion/companion.test.ts`

**Interfaces:**

- Consumes: `DigestClient`, `BoardUnderstanding`, `EMPTY_UNDERSTANDING` from Task 4; `DRIFT_THRESHOLD`, `driftOf` from Task 1
- Produces: `CompanionOptions.digest?: DigestClient`; `boardUnderstanding` atom in `companionState.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/companion/companion.test.ts`, following the fake-client pattern already used there for `observer`/`suggest`/`reflect`. Add to that file's existing imports:

```ts
import { EMPTY_UNDERSTANDING } from '@/companion/digestClient'
import { boardUnderstanding, companionQueue } from '@/companion/companionState'
```

```ts
describe('the standing understanding', () => {
	it('derives once the board drifts past the threshold', async () => {
		const digest = { digest: vi.fn().mockResolvedValue(EMPTY_UNDERSTANDING) }
		const harness = createHarness({ digest })

		// Two new notes is drift 6 — exactly the threshold.
		harness.emit({ type: 'node_created', nodeId: 'a' })
		harness.emit({ type: 'node_created', nodeId: 'b' })
		await harness.settleEpisode()

		expect(digest.digest).toHaveBeenCalledOnce()
		harness.dispose()
	})

	it('does not derive for dragging, however much of it', async () => {
		const digest = { digest: vi.fn().mockResolvedValue(EMPTY_UNDERSTANDING) }
		const harness = createHarness({ digest })

		for (let i = 0; i < 50; i++) {
			harness.emit({
				type: 'node_moved',
				nodeId: 'a',
				previous: { x: 0, y: 0 },
				current: { x: i, y: i },
			})
		}
		await harness.settleEpisode()

		expect(digest.digest).not.toHaveBeenCalled()
		harness.dispose()
	})

	it('never puts a derivation in the thought queue', async () => {
		const digest = { digest: vi.fn().mockResolvedValue(EMPTY_UNDERSTANDING) }
		const harness = createHarness({ digest })

		harness.emit({ type: 'node_created', nodeId: 'a' })
		harness.emit({ type: 'node_created', nodeId: 'b' })
		await harness.settleEpisode()

		// A digest speaks to nobody; it must not take a speaking slot.
		expect(companionQueue.get().some((t) => t.gesture.includes('digest'))).toBe(false)
		harness.dispose()
	})

	it('keeps the previous understanding when a derivation fails', async () => {
		const good = { ...EMPTY_UNDERSTANDING, reading: 'A board about why deals stall.' }
		const digest = {
			digest: vi.fn().mockResolvedValueOnce(good).mockRejectedValueOnce(new Error('502')),
		}
		const harness = createHarness({ digest })

		harness.emit({ type: 'node_created', nodeId: 'a' })
		harness.emit({ type: 'node_created', nodeId: 'b' })
		await harness.settleEpisode()
		harness.emit({ type: 'node_created', nodeId: 'c' })
		harness.emit({ type: 'node_created', nodeId: 'd' })
		await harness.settleEpisode()

		expect(boardUnderstanding.get()?.reading).toBe('A board about why deals stall.')
		harness.dispose()
	})

	it('ships the understanding and its staleness to the observer', async () => {
		const understanding = { ...EMPTY_UNDERSTANDING, reading: 'A board about why deals stall.' }
		const digest = { digest: vi.fn().mockResolvedValue(understanding) }
		const harness = createHarness({ digest })

		harness.emit({ type: 'node_created', nodeId: 'a' })
		harness.emit({ type: 'node_created', nodeId: 'b' })
		await harness.settleEpisode()
		harness.emit({ type: 'node_created', nodeId: 'c' })
		await harness.settleEpisode()

		const request = harness.observer.observe.mock.calls.at(-1)![0]
		expect(request.understanding?.reading).toBe('A board about why deals stall.')
		expect(request.driftSince).toBeGreaterThan(0)
		harness.dispose()
	})
})
```

If `createHarness` does not already exist in `companion.test.ts`, use whatever fake-companion construction that file already uses and mirror it; do not introduce a second style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/companion/companion.test.ts`
Expected: FAIL — `digest` is not a recognised option and no derivation fires.

- [ ] **Step 3: Add the atom**

Append to `src/companion/companionState.ts`:

```ts
/**
 * What the companion currently understands the board to be.
 *
 * Published so a panel can show it later, and so a test can read it without reaching inside
 * the orchestrator. `null` until the first digest returns.
 */
export const boardUnderstanding = atom<BoardUnderstanding | null>(
	'companion board understanding',
	null
)
```

with `import type { BoardUnderstanding } from '@/companion/digestClient'` at the top.

- [ ] **Step 4: Add the two optional request fields**

In each of `observerClient.ts` (`ObserveRequest`), `suggestClient.ts` (`SuggestRequest`) and `reflectClient.ts` (`ReflectRequest`), add:

```ts
	/** The companion's standing reading of the board. Absent until the first digest returns. */
	understanding?: BoardUnderstanding
	/** How much the board has drifted since that reading was taken. */
	driftSince?: number
```

with `import type { BoardUnderstanding } from '@/companion/digestClient'`.

- [ ] **Step 5: Wire the orchestrator**

In `src/companion/companion.ts`:

1. Extend the imports with `DRIFT_THRESHOLD`, `driftOf` from `@/domain`, `boardUnderstanding` from `@/companion/companionState`, and the digest client types.

2. Add to `CompanionOptions`:

```ts
	/**
	 * The board digest. Optional: without it the companion runs exactly as it did before, with
	 * no standing understanding in any prompt.
	 */
	digest?: DigestClient
```

3. Add module-level state beside `lastProactiveAt`:

```ts
/** What the companion understands the board to be, and how far the board has moved since. */
let understanding: BoardUnderstanding | null = null
let drift = DRIFT_THRESHOLD
let deriving = false
```

`drift` starts at the threshold so the first meaningful episode on a non-empty board bootstraps a reading rather than waiting for six more changes.

4. Add the derivation, which deliberately does **not** touch `enqueue`:

```ts
/**
 * Re-read the whole board in the background.
 *
 * Off the queue and off the critical path: a digest speaks to nobody, so it must never take
 * a speaking slot or make a remark wait. A failure leaves the previous understanding and the
 * drift score alone, so the next episode simply tries again.
 */
const derive = async (boardSummary: BoardSummary) => {
	if (!digest || deriving) return
	deriving = true
	try {
		const next = await digest.digest({ board: boardSummary, recentComments: recentComments() })
		if (disposed) return
		understanding = next
		boardUnderstanding.set(next)
		drift = 0
	} catch {
		// Keep what we had. A stale reading is better than none, and better than a wrong one.
	} finally {
		deriving = false
	}
}
```

5. In `handleEpisode`, accumulate drift **before** the trivial-episode gate — a note created in an otherwise quiet episode still changes what the board is about:

```ts
drift += driftOf(events)
```

and, after the existing gates have decided whether to enqueue a thought, schedule a derivation when it is due:

```ts
// Free, local, and above the model call — the same shape as `isTrivialEpisode`.
const boardSummary = board?.()
if (digest && boardSummary && boardSummary.nodeCount >= 3 && drift >= DRIFT_THRESHOLD) {
	void derive(boardSummary)
}
```

6. Pass the understanding into all four call sites — `observer.observe`, both `reflect.reflect` calls and `suggest.suggest` — adding to each request object:

```ts
					understanding: understanding ?? undefined,
					driftSince: drift,
```

- [ ] **Step 6: Wire the canvas**

In `src/canvas/Canvas.tsx`, add the import beside its three siblings and the option beside `reflect:`:

```ts
import { createHttpDigestClient } from '@/companion/digestClient'
```

```ts
		// Re-reads the whole board every few material changes and keeps the result, so the other
		// three agents are given what the board *is* alongside what just happened.
		digest: createHttpDigestClient(),
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, including the five new companion tests.

- [ ] **Step 8: Verify in the running app**

```bash
npm run dev -- --port 5199
```

Add four notes, then drag one for a while. Expect exactly one `POST /api/digest` in the network tab (on the notes, not the dragging), no extra chip in the companion bar, and subsequent `/api/observe` bodies carrying `understanding` and `driftSince`. Port 5199 rather than 5173, which is usually another workspace.

- [ ] **Step 9: Commit**

```bash
npx prettier --write src/companion/companion.ts src/companion/companionState.ts src/companion/observerClient.ts src/companion/suggestClient.ts src/companion/reflectClient.ts src/companion/companion.test.ts src/canvas/Canvas.tsx
git add -A src/
git commit -m "feat(companion): keep a standing understanding and ship it with every ask"
```

---

### Task 6: Prove it helps — eval fixtures and docs

The gate. Injection could plausibly make the companion chattier or make it narrate its own themes; the corpus is what says so before the user notices.

**Files:**

- Modify: `evals/episodes.ts`, `evals/run.ts`
- Modify: `CODEMAP.md`, `README.md`, `.env.example`

**Interfaces:**

- Consumes: `EpisodePayload` (now carrying `understanding` and `driftSince`)
- Produces: four new fixtures; a `narrated themes` counter in the eval report

- [ ] **Step 1: Add the fixtures**

In `evals/episodes.ts`, add a shared understanding and four fixtures. The board's ids are `a`–`f` as already defined there.

```ts
/** What the companion understands this board to be, for the two-layer fixtures. */
const UNDERSTANDING = {
	themes: [
		{ name: 'Deal friction', meaning: 'What stalls enterprise deals', members: ['a', 'b'] },
		{ name: 'Getting started', meaning: 'What new teams hit first', members: ['c', 'd'] },
	],
	reading: 'A board about why enterprise deals stall, and separately about onboarding.',
	narrative: 'Started at pricing, kept returning to SSO, only lately looked at onboarding.',
	tensions: ['Nothing yet connects the sales friction to the onboarding friction.'],
	derivedFromNodes: ['a', 'b', 'c', 'd', 'e', 'f'],
}
```

```ts
	{
		name: 'fits-the-understanding',
		expect: 'silent',
		note: 'Pricing and SSO drawing closer is exactly what "Deal friction" already says. Accounted for.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'a' }],
				pairs: [pair('a', 'b', 0.55, 0.68)],
			},
			context: ctx(),
			board: BOARD,
			understanding: UNDERSTANDING,
			driftSince: 2,
		},
	},
	{
		name: 'contradicts-the-understanding',
		expect: 'speak',
		note: 'The two themes the reading held apart are now bridged. The understanding is wrong, which is the most worth saying.',
		payload: {
			episode: {
				structural: [{ type: 'relation_created', source: 'a', target: 'c', gravity: 0.8 }],
				pairs: [pair('a', 'c', 0.05, 0.62, ['proximity_changed:strong'])],
			},
			context: ctx(),
			board: BOARD,
			understanding: UNDERSTANDING,
			driftSince: 3,
		},
	},
	{
		name: 'extends-the-understanding',
		expect: 'speak',
		note: 'A loner joins a named theme the reading did not have it in.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'e' }],
				pairs: [pair('e', 'a', 0.03, 0.58, ['field_entered'])],
			},
			context: ctx(),
			board: BOARD,
			understanding: UNDERSTANDING,
			driftSince: 1,
		},
	},
	{
		name: 'understanding-is-not-a-topic',
		expect: 'silent',
		note: 'A rich understanding plus a trivial nudge. The reading must not become something to talk about.',
		payload: {
			episode: {
				structural: [{ type: 'node_moved', nodeId: 'f' }],
				pairs: [pair('f', 'e', 0.31, 0.33)],
			},
			context: ctx(),
			board: BOARD,
			understanding: UNDERSTANDING,
			driftSince: 9,
		},
	},
```

Add `understanding?: unknown` and `driftSince?: number` to the fixture payload type only if `EpisodePayload` does not already permit them — after Task 3 it does, so no change should be needed.

- [ ] **Step 2: Report theme-narration**

In `evals/run.ts`, add a counter beside the remark-length stats. A remark that names a theme verbatim is the specific regression this feature risks:

```ts
/** Theme names the observer must not simply read back. */
const THEME_NAMES = ['Deal friction', 'Getting started']
```

```ts
const narrated = usable.filter(
	(t) => t.spoke && THEME_NAMES.some((n) => t.comment.includes(n))
).length
```

```ts
console.log(
	`narrated a theme      ${narrated}/${usable.filter((t) => t.spoke).length}   <- must stay 0`
)
```

- [ ] **Step 3: Run the eval and compare against the recorded baseline**

Run: `npm run eval`

Baseline to beat, recorded 2026-08-29 before this feature:

| Metric                  | Baseline     |
| ----------------------- | ------------ |
| spoke when wanted       | 29/30 (97%)  |
| silent when wanted      | 30/30 (100%) |
| over-speaking           | 0/30 (0%)    |
| remark chars mean / max | 121 / 169    |

Pass conditions: over-speaking stays at 0, `narrated a theme` is 0, and the four new fixtures each agree with their `expect`. **If over-speaking rises, the triage wording is the cause — revise `UNDERSTANDING_TRIAGE`, not the fixtures.**

- [ ] **Step 4: Update the docs**

`.env.example` — add beside `REFLECT_MODEL`:

```
# Optional. Reasoning model for the board digest. Falls back to OBSERVER_MODEL, then the default.
DIGEST_MODEL=claude-sonnet-5
```

`CODEMAP.md` — in the `server/` section: change "the four routes" to "the five routes", add `/api/digest` to the `index.ts` row, and add rows for `digest.ts`, `digestPrompt.ts` and `prompting/understanding.ts`. Update the two Mermaid diagrams' `server/` node labels. **Validate every diagram before committing** — a broken one fails silently on GitHub:

````bash
npm install --no-save --cache .context/.npm-cache @mermaid-js/mermaid-cli
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
echo '{"args":["--no-sandbox"]}' > /tmp/pp.json
# extract each ```mermaid block to a .mmd file, then for each:
npx mmdc -p /tmp/pp.json -i block.mmd -o block.svg
````

`README.md` — in the section describing the server, note the fifth route and add a short paragraph on the two-layer context: the board as it is, and the reading of what it means, with the fits/extends/contradicts triage between them.

- [ ] **Step 5: Final verification and commit**

```bash
npm run typecheck && npm run lint && npm test
npx prettier --write evals/episodes.ts evals/run.ts CODEMAP.md README.md
npm run format:check   # only the 12 pre-existing files may warn
git add -A
git commit -m "feat: measure the standing understanding and document it"
```

---

## Notes for the executor

- **Fail-safe is the invariant to protect.** Every field added in this plan is optional, and every prompt section is omitted when absent. If you find yourself making one required, you have broken the property that lets this ship — a companion with no digest must behave exactly as it did before.
- **The digest must never speak.** It has no queue slot, no chip and no voice. If a derivation ever produces a remark, that is a bug in Task 5, not a feature.
- **`npm test` must stay free.** If you find yourself adding a fixture that calls the API from `src/**`, it belongs in `evals/` instead.
