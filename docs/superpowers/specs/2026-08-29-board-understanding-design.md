# Board understanding — a standing reading, injected into every agent

**Date:** 2026-08-29
**Requirement:** Derive the board's meaning once, keep it, and give every agent both layers — what
the board _is_, and what just _happened_ — so a response is formed from the pair.

## Why

Three context layers already ride along on every agent call. A fourth is missing, and it is the
only one that carries meaning.

| Layer                       | Source                      | What it says                                | Recomputed     |
| --------------------------- | --------------------------- | ------------------------------------------- | -------------- |
| The episode                 | `buildEpisodeSummary`       | What just happened                          | Per episode    |
| The board, structurally     | `boardSummary.ts`           | Which ideas cluster, stand alone, sit close | **Every call** |
| What was recently said      | `recentComments()` (last 3) | Anti-repetition only                        | Every call     |
| **What the board is about** | **—**                       | **—**                                       | **—**          |

`BoardSummary` is deliberately semantic-free: it is "a pure fold over a `CanvasDocument` that
recomputes nothing", coordinate-free by design, and it reports _geometry_ — `clusters`, `loners`,
`proximities`, `effectiveStrengths`. It can say that four notes sit together. It cannot say that
they are four faces of one problem.

So every agent re-derives meaning from raw note text on every single call, and keeps none of it.
Three consequences, all observable today:

- **The observer has no session arc.** It sees three prior comments and nothing else, so it cannot
  know the user has been circling pricing for ten minutes. It re-notices the same shape in new
  words, which the anti-repetition block can only partly mask.
- **The suggester and the reflection disagree with each other**, because each invents its own
  reading of the same board from scratch, and nothing reconciles them.
- **Nothing accumulates.** `companionTranscript` retains 50 remarks but they are output, not
  understanding. Reload loses even that; only tldraw's own `persistenceKey` survives.

## Decisions

1. **A fourth agent, not an extension of `reflect`.** `reflect` is user-triggered, persona-flavoured,
   and speaks to the user. Maintaining internal state is a different job with a different cadence,
   and a Critique-flavoured understanding would poison the other three agents. `digest` gets its own
   prompt, schema and model var, exactly as `suggest` and `reflect` did.
2. **The understanding lives on the client and ships in the payload.** The server is a stateless
   proxy by design — "the repo was backend-free by design; this exists only because the companion
   calls two paid APIs". Session state on the server would reverse that for no gain. It rides
   alongside `board` and `recentComments`, which already work this way.
3. **The whole feature is additive-optional.** Every payload field is optional and every prompt
   section is omitted when absent. A digest that fails, times out, or was never run leaves all three
   agents behaving exactly as they do today. This is the property that makes it safe to ship.
4. **The staleness trigger is local and free.** Deciding _whether_ to spend money must not cost
   money. `isTrivialEpisode` is the existing precedent: a pure gate above the model call, because
   "a cap enforced after the request is a display cap and an uncapped bill".
5. **Derivation never blocks a remark.** It runs in the background off the critical path. A stale
   understanding is shipped _with its staleness stated_, which is strictly better than making the
   user wait for a fresh one.
6. **Ids are validated, prose is bounded.** A theme naming notes that no longer exist is dropped,
   reusing the pattern in `interpretGrouping` and `interpretReflection`. Free text passes
   `isCleanRemark`, because a digest is as capable of leaking scaffolding as any other agent.

## Architecture

### `server/digestPrompt.ts` — the digest's character

```ts
export interface Theme {
	name: string
	meaning: string
	members: string[]
}
export interface BoardUnderstanding {
	themes: Theme[] // <= MAX_THEMES (5)
	reading: string // what this board is about, 1-2 sentences
	narrative: string // what the session has been circling
	tensions: string[] // what it leaves unresolved, <= MAX_TENSIONS (3)
	derivedFromNodes: string[]
}
export const MAX_THEMES = 5
export const MAX_TENSIONS = 3
export const NO_UNDERSTANDING: BoardUnderstanding
export function digestModel(): string // DIGEST_MODEL ?? OBSERVER_MODEL ?? default
export function renderDigestRequest(payload): string
export function interpretUnderstanding(text, board?): BoardUnderstanding
```

Composes `CANVAS_PRIMER` from `prompting/fragments.ts` and renders the board with
`renderBoardBlocks` — the digest reads the same board the reflection does, so it uses the same
renderer. It is given the recent transcript too: `narrative` is about the session, not the snapshot.

`interpretUnderstanding` drops themes whose `members` are not real ids, drops themes left with fewer
than two members, caps the lists, and blanks any free-text field failing `isCleanRemark`.

### `server/digest.ts` and `server/index.ts`

`digest.ts` is a fourth sibling of `observe`/`suggest`/`reflect` — a `callStructured` config and
nothing else. `index.ts` gains `POST /api/digest` under the same 256 KB `bodyLimit`, failing safe to
`NO_UNDERSTANDING`.

### `src/domain/understandingDrift.ts` — when the reading has gone stale

Pure, no tldraw, no network. The event stream already emits everything needed; the companion already
subscribes to it. No polling and no second diff.

```ts
export const DRIFT_THRESHOLD = 6
export function driftWeight(event: SpatialEvent): number
export function driftOf(events: SpatialEvent[]): number
```

Weights reflect what changes _meaning_ rather than what changes _pixels_:

| Event                                                       | Weight | Why                                        |
| ----------------------------------------------------------- | ------ | ------------------------------------------ |
| `node_created`, `node_deleted`                              | 3      | New or lost content is new or lost meaning |
| `relation_created`, `relation_deleted`, `relation_rebound`  | 2      | An explicit claim made or retracted        |
| `proximity_changed` to strong                               | 1      | A cluster forming is a theme forming       |
| `contextual_field_changed`                                  | 1      | Changes who is in whose context            |
| `relation_gravity_changed`                                  | 0      | Re-weighting a claim is not re-stating it  |
| `node_moved`, `influence_changed`, `field_entered`/`exited` | 0      | The observer's job, not the digest's       |

Threshold 6 ≈ two new notes, or a note plus a relation. Bootstrap reuses the proactive-grouping gate
(`nodeCount >= 3`) so the first derivation fires once the board is worth reading at all.

### `src/companion/digestClient.ts` and `companion.ts`

`digestClient.ts` mirrors its three siblings: an interface for tests to fake, an HTTP implementation,
`AbortSignal.any([caller, timeout])`. The companion holds `understanding` plus an accumulated drift
score, adds drift per episode, and when it crosses the threshold fires a background derivation that
**does not enter the thought queue** — it produces no remark and must never take a speaking slot.

A failed derivation keeps the previous understanding and leaves the drift score untouched, so the
next episode retries. `companionState.ts` gains a `boardUnderstanding` atom so the UI can show what
the companion currently believes.

### Injection into the three existing agents

`ObserveRequest`, `SuggestRequest` and `ReflectRequest` each gain an optional `understanding`.
Rendering is one shared helper in `prompting/`, so all three phrase it identically:

```ts
export function renderUnderstanding(
	understanding: BoardUnderstanding | undefined,
	driftSince: number | undefined
): string[]
```

Placed **after** the change and beside the structural board — never before it. `prompt.ts` puts the
board after the episode deliberately, so that the change stays the subject; a standing reading is
even more background than the board is, and leading with it would invert that.

## The prompt engineering

The fragment is not more context. It is a decision procedure, and it inherits the app's own idea.

`CANVAS_PRIMER` already tells every agent that when proximity and an explicit relation disagree,
"that is information, not a mistake". The same move applies one level up: **when the standing
understanding disagrees with what just happened, that gap is the most interesting thing on the
board.** `prompting/fragments.ts` gains:

```
You are also given a standing understanding of this board — its themes, what the session has been
circling, and the tensions it leaves open. It was derived earlier and may be out of date. Treat it
as your own prior reading, not as current truth.

Judge what just happened against it:
- The change FITS the understanding — it is already accounted for. Usually stay silent.
- The change EXTENDS it — it names something the understanding does not yet hold. Worth a word if
  the addition is real.
- The change CONTRADICTS it — the board is no longer what you understood it to be. This is the most
  worth saying, and naming what changed about the whole beats describing the move.

A standing understanding is never itself a reason to speak. Do not summarize it, list its themes, or
remark on parts of the board this change did not touch.
```

Three things that paragraph is doing:

- **"your own prior reading, not current truth"** licenses the model to notice the reading is now
  wrong — which is itself the most remarkable thing it could notice.
- **The fits/extends/contradicts triage** is the concrete form of "form the response from both
  layers". It should _lower_ the speak rate on routine changes and raise it on genuinely new ones.
- **The last line** is the guard the board summary already needed ("a board summary is never a
  reason to speak"). Without it the model narrates the themes back at the user.

Staleness is stated in the rendered text, not just tracked: _"It was taken 8 changes ago, so parts of it may already be wrong."_ The renderer phrases it from the drift score rather than taking a pre-built string, so all three consumers say it the same way. Staleness is counted in **changes, not seconds** — a reading goes wrong because the board moved, not because time passed.
A model told its context is old discounts it correctly; a model shown stale context as fact does not.

## Testing

- **`understandingDrift.test.ts`** — weights per event type; a drag storm scores 0; two new notes
  cross the threshold.
- **`renderDigest.test.ts`** — alongside its three siblings in `src/companion/`, importing
  `server/digestPrompt.ts` by relative path as they do. Covers rendering, and that
  `interpretUnderstanding` drops hallucinated ids, under-populated themes, over-long lists and
  unclean prose.
- **Render tests for the three consumers** — each states the understanding when given one, and omits
  the section entirely when not.
- **`companion.test.ts`** — a derivation fires on threshold, runs off the queue, produces no remark,
  and a failure preserves the previous understanding.
- **`evals/`** — new fixtures pairing an episode with a supplied understanding it either fits or
  contradicts, asserting silence on the first and speech on the second. Compare speak rate against
  the recorded baseline (29/30 speak, 30/30 silent, mean remark 121 chars). **This is the gate:** if
  injection makes the companion chattier or makes it narrate themes, the corpus says so.

## Out of scope

- **Persistence across reload.** The board returns via tldraw's `persistenceKey` and drift
  bootstraps a fresh derivation. `narrative` is session-scoped by nature and will not survive; that
  is accepted, not overlooked.
- **Showing the understanding in the UI.** The atom is published so a panel can be built later; no
  panel is part of this.
- **Letting the user edit the understanding.** Interesting, and a different feature.
- **Sharing it between agents' _outputs_** — the digest informs the three agents; it does not merge
  or arbitrate what they say.
