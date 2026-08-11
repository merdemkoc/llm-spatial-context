# MVP 0 — Effective strength & change detection

**Date:** 2026-08-11
**Requirement:** MVP 0 — Gravity & Influence Ontology

## Why

MVP 0 asks for the minimum ontology needed to interpret spatial influence and explicit relations.
Cross-referenced against the repo, five of its seven sections already ship:

| §     | Requirement                       | Status                                                       |
| ----- | --------------------------------- | ------------------------------------------------------------ |
| 1     | `influence = max(0, 1 − d/r)`     | Done — `calculateSpatialInfluence`                           |
| 2     | Relation-level `gravity`          | Done — `Relation.gravity`, `clampGravity`, style-panel input |
| 3     | Four states stay distinguishable  | Done — separate `relations` / `spatialContext` layers        |
| 6     | No semantic inference             | Done — `type` never defaulted, proximity never a relation    |
| 7     | JSON exposes both signals         | Done                                                         |
| **4** | **Effective strength, pluggable** | **Missing — and actively refused by the current design**     |
| **5** | **Change tracking over time**     | **Missing — the model has no notion of time**                |

So the work is §4 and §5. Both required resolving a conflict first.

### Conflict 1 — §4 contradicts a documented invariant

The repo does not merely lack a combined signal; it argues against one, in three places:

- `README.md` — "**No `effectiveInfluence` is computed**, and nothing blends the two, because
  collapsing them would destroy the only thing this model is trying to preserve."
- `CODEMAP.md`, under **Key invariants** — "The two strength signals are reported side by side and
  never combined."
- `relationEditor.test.ts` — `expect(JSON.stringify(document)).not.toContain('effectiveInfluence')`

**Resolution.** Effective strength is added as a _third_ derived signal. `influences[]` and
`relations[]` stay byte-for-byte unchanged beside it, and every combined row names the function that
produced it. The invariant is reworded from **"never combined"** to **"never conflated"**: the
inputs remain separately readable, so nothing is destroyed — a reader who wants the unmixed signals
still has them, and a reader who wants a single ranking number now has one that shows its work.

### Conflict 2 — §4 contradicts itself arithmetically

§4 says an explicit relation should **amplify** contextual influence, and its worked example uses
`gravity: 3.0` → `0.35 × 3.0 = 1.05`. But `clampGravity` caps gravity at `1`, so
`influence × gravity` can only ever _shrink_ the number: `0.35 × 1.0 = 0.35`. Plain multiplication
with a normalised gravity is therefore precisely the wrong function — it fails §4's own demand that
intent "have significantly more weight than proximity alone".

**Resolution.** Gravity stays `0–1` and effective strength stays `0–1`; **the amplification lives in
the combining function, not in the data.** This is what §4 asks for anyway ("do not hard-code the
final multiplier model… make it possible to experiment with different functions later"), and it
preserves `clampGravity`'s argued semantics, the `g 0.60` badge on the grounded screenshot, and how
arrows already persisted in IndexedDB read back.

## Decisions

1. Effective strength is a **third** derived signal; the two inputs stay intact.
2. Gravity `0–1`, effective strength `0–1`; the combiner does the amplifying.
3. §5 ships as a **pure function only** — no store listener, no session log, no UI, no persistence.
4. New sibling array `spatialContext.effectiveStrengths[]`.
5. `diffCanvas` returns **flat** `{ changes, pairs }` — no action→consequence attribution.
6. Two arrows on one directed pair → **clamped sum** of their gravities.

`relations` stays at the document root. §7 sketches `spatialContext: { influences, relations }`, but
nesting user-stated claims inside a layer named `spatialContext` would undercut the four-layer split
the project exists to maintain. §7's actual requirement — "expose enough information for an external
AI system to reason about the current spatial state" — is already met.

## Architecture

Two new pure modules in `src/domain/`, joined to the document at the one place documents are built.

```
src/domain/effectiveStrength.ts   the join: influence × gravity → effective, via a named strategy
src/domain/canvasDiff.ts          two documents → what changed between them
```

Neither imports tldraw; ESLint enforces that. `spatialInfluence.ts` keeps computing `influences`
from geometry alone, so "nothing in the proximity math looks at arrows" still holds for that array.

### `effectiveStrength.ts`

```ts
export interface EffectiveStrength {
	source: NodeId
	target: NodeId
	influence: number // copied from the geometry, unchanged
	gravity: number // copied from intent, unchanged
	effectiveStrength: number
	strategy: StrategyName // makes the number auditable and the model swappable
}
```

Three strategies, one default:

| Name                        | Function                          | `0.35 / 1.0` | Why it exists                                                      |
| --------------------------- | --------------------------------- | ------------ | ------------------------------------------------------------------ |
| `intent_weighted` (default) | `infl·(1−w) + grav·w`, `w = 0.75` | `0.838`      | Intent 3× proximity; High+High (`0.975`) still beats Low+High      |
| `product`                   | `infl × grav`                     | `0.35`       | §4's literal formula — kept so its failure is a test, not a debate |
| `lift`                      | `infl + grav·(1 − infl)`          | `1.0`        | Probabilistic OR; saturates, so it flattens High+High vs Low+High  |

`buildEffectiveStrengths(nodes, relations, strategy?)` emits **one row per directed pair holding at
least one relation**. A pair at `influence: 0` with `gravity: 1` _does_ get a row — that is §3's
"explicitly related despite distance", the most interesting of the four states. Per-pair gravity is
`clampGravity(Σ gravities)`.

### `canvasDiff.ts`

`diffCanvas(before, after, strategy?) → { changes, pairs }`

Eight change kinds — the seven §5's list implies, plus `relation_gravity_changed`, which the list
omits although the style panel already lets a user do it:

`node_created` · `node_deleted` · `node_moved` · `contextual_field_changed` ·
`relation_created` · `relation_deleted` · `relation_rebound` · `relation_gravity_changed`

Design claims, each of which earns a comment in the file:

- **`node_moved` compares `nodeCenter`, not raw `x`/`y`.** Rotation is applied about the unrotated
  top-left and a resize changes width/height, so both move the centre and therefore every distance.
  Reporting the centre lets one kind cover all three honestly.
- **Absent ≠ zero.** A node gaining a field it never had is `{ after: 200 }` with no `before` key,
  never `{ before: 0 }` — the same rule the rest of the model follows.
- **`relation_rebound` is detectable** because `RelationId` derives from the arrow's shape id, so
  dragging one end is an _update_, not a delete plus a create.
- **Epsilon = the document's own rounding.** Distance at 0dp, the rest at 3dp, so a diff never
  reports a change a reader cannot see in the JSON.
- **No attribution.** `changes` and `pairs` are siblings, not nested. When two nodes both moved,
  crediting a pair's influence change to one of them is exactly the inference §6 forbids.

## Testing

Pure layer, `node` env: `domain/effectiveStrength.test.ts` covers each strategy's corners, the
four-state ordering, the clamped sum, and `product`'s failure to satisfy §120.
`domain/canvasDiff.test.ts` covers all eight kinds, absent-vs-zero radius, one-sided pair deltas
across create/delete, rotation- and resize-only edits, sub-epsilon suppression, and ordering.

`adapter/relationEditor.test.ts` has its never-combined assertion replaced with the never-conflated
one: `influences[]` rows carry no `gravity`, `relations[]` records carry no `influence`, and
`effectiveStrengths[]` carries both plus `strategy`.

## Out of scope

Everything §6 rules out — relation vocabulary, causality, whether proximity means similarity — plus,
by decision 3, any runtime change log, UI, or persistence for `diffCanvas`.
