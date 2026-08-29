# llm-spatial-context

An experiment in giving an LLM **grounded spatial context** about a [tldraw](https://tldraw.dev) infinite canvas. A canonical model describes _what exists_ on the canvas — nodes, their geometry, and what the user explicitly connected — across four deliberately-separated layers, so a reader (a person or a model) can reach the same entity **semantically** (its text), **spatially** (where it sits and what its field reaches), **relationally** (what the user connected, named, and how strongly), and **visually** (which pixels of a screenshot it occupies). Derived data is never stored, and proximity never silently becomes a relation. The two strength signals — spatial influence and relational gravity — are combined into a single ranking number only in a third layer that carries both of its inputs and names the function it used, so they are never _conflated_.

On top of that model sits the part the rest of it was for: an [AI companion](#the-ai-companion) that watches the representation change, groups the changes into episodes, and speaks only when it judges one worth remarking on.

Built on tldraw, Vite, React 19 and TypeScript, with a two-route Hono server for the companion's model and voice calls.

![The canvas with contextual-field overlays, influence badges, and the live canonical-JSON inspector](docs/images/inspector-hero.png)

## Contents

- [Why this exists](#why-this-exists)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Architecture](#architecture)
  - [Contextual field](#contextual-field)
  - [Four layers of context](#four-layers-of-context)
  - [Relations](#relations)
  - [Relational gravity](#relational-gravity)
  - [Effective strength](#effective-strength)
  - [Change detection](#change-detection)
  - [Event stream](#event-stream)
  - [The AI companion](#the-ai-companion)
  - [Grounded screenshot](#grounded-screenshot)
- [Layout](#layout)
- [Where to add things](#where-to-add-things)
- [Known limitations](#known-limitations)
- [Testing](#testing)
- [Persistence](#persistence)
- [A note on the tldraw license](#a-note-on-the-tldraw-license)
- [Docs](#docs)

For a file-by-file map of the code — every module, its key exports, and the test layout — see [`CODEMAP.md`](./CODEMAP.md).

## Why this exists

The claim underneath this prototype is that **representation might not just be the output of thinking — it might be part of the thinking itself.** When someone moves an idea closer to another, groups a few together, or draws a line between two of them, what changes is often not the content but the arrangement. So the question is:

> **What happens if an AI can observe that representation directly — and share it?**

The building blocks are deliberately few. Two of them are not built yet, and are marked rather than implied:

| Primitive              | What it carries                                                | Where it lives                    | Status         |
| ---------------------- | -------------------------------------------------------------- | --------------------------------- | -------------- |
| **Ideas**              | The content of a thought — a note, a question, a claim         | `nodes[].content`                 | Built          |
| **Images**             | Thinking isn't only words: a photo, a reference, a visual idea | —                                 | **Planned**    |
| **Semantic relations** | The connection the user drew, and what they called it          | `relations`                       | Built          |
| **Spatial relations**  | Distance, proximity, grouping — arrangement as a signal        | `spatialContext.influences`       | Built          |
| **Context**            | The field around an idea, rather than the idea alone           | `contextualField.radius`          | Built          |
| **Attention**          | What the user selects, focuses on, is working on               | —                                 | **Planned**    |
| **Change**             | How all of the above evolves while someone thinks              | the [event stream](#event-stream) | Built, spatial |

`NodeType` has exactly one concrete member, `post_it`, so **image nodes are planned** — the Node abstraction takes more, nothing has been added to it. **Attention is planned** too, and it is the more interesting gap: selecting a note changes what the canvas _shows_ you, but selection never enters `CanvasDocument`, emits no event, and never reaches the observer. **Change is built, but only its spatial half** — a text edit produces no event, deliberately.

The three primitives that are built are not the same kind of evidence, and the design's first commitment is that they never collapse into one:

```mermaid
graph TD
    canvas(["CANVAS"])
    canvas --> content["<b>Content</b>"]
    canvas --> spatial["<b>Spatial</b>"]
    canvas --> relation["<b>Relation</b>"]
    content --> text["text"]
    spatial --> distance["distance"]
    distance --> influence["influence"]
    relation --> arrow["arrow"]
    arrow --> gravity["gravity"]

    classDef semantic fill:#eef7ee,stroke:#5a5,color:#243;
    classDef implicit fill:#fff7e6,stroke:#c93,color:#663;
    classDef explicit fill:#eef2fb,stroke:#55a,color:#224;
    class content,text semantic;
    class spatial,distance,influence implicit;
    class relation,arrow,gravity explicit;
```

| Signal                 | What does it tell us?                                | Strength          |
| ---------------------- | ---------------------------------------------------- | ----------------- |
| **Content**            | What does the node say?                              | Semantic evidence |
| **Spatial influence**  | How are nodes organized in space?                    | Implicit signal   |
| **Relational gravity** | What relationship did the user explicitly establish? | Explicit signal   |

**These must not collapse into a single notion of "relationship."** A node can be semantically related to another without being spatially close; two nodes can be spatially close with no explicit relationship; and an explicit relation can hold between two nodes that are far apart. Keeping them distinct is what lets a model reason across all three without losing track of where each claim came from — the mechanics are in [Four layers of context](#four-layers-of-context).

The fourth layer answers a different question: which _pixels_ is this node? A model handed a screenshot and a JSON document would otherwise have to work that out from world coordinates, and inferring it is exactly the guess the rest of this design removes — so [`grounding`](#grounded-screenshot) states the mapping instead.

Hand-run against Gemini with a grounded PNG and the canonical JSON — nothing from those sessions is checked into this repo — the model grounded each entity to its visual object, recovered the direction of the explicit relations, and reasoned about proximity. The useful part was a disagreement: the arrows assert `N4 → N1` and `N3 → N2`, while the notes' content implies `N4 → N3 → N1 → N2`. The representation let the model **see both structures instead of averaging them into one graph**.

The canvas below reproduces that structure — nothing from the sessions themselves survives, so this is a reconstruction rather than the artifact the model was handed:

![Four post-its exported as a grounded screenshot, outlined in pink and labelled N1 to N4, with two relation arrows — one labelled 'constrains' — connecting separate pairs](docs/images/gravity-canvas-grounded.png)

None of that is a static picture, though, and the part I find most interesting is that it isn't. A representation is not something you arrive at — it changes while you think, and for an AI the useful signal may be the _process of change_ rather than the final state. So change is observable too: `diffCanvas` compares two documents, `deriveEvents` restates the difference as an ordered [event stream](#event-stream), and the stream is grouped into **episodes** — everything between one pause and the next.

The [AI companion](#the-ai-companion) is what consumes it. It watches the representation change, decides whether anything meaningful happened, and speaks only when it thinks so — silence is the normal outcome. That closes the loop, but it closes it **through the human**: the companion can observe the representation and talk about it, and cannot yet reach into it.

Still open, in rough order of interest:

- **attention and image nodes** — the two primitives above with no implementation behind them;
- **semantic change** — a text edit reaches neither the stream nor the observer, so the model sees you rearrange ideas but not rewrite them;
- **the AI writing entities and relations back** into the space it is reasoning about;
- a canvas as a **spatial computational substrate** rather than a rendering surface, where structure comes from configuration rather than containment.

The full research note — the argument, the primitives, the Gemini tests and where this points — is in [`docs/why.md`](./docs/why.md).

## Getting started

Requires Node `>=22.12.0` (a tldraw SDK requirement).

```bash
npm install
cp .env.example .env   # add the two API keys — see below
npm run dev
```

Open http://localhost:5173. `npm run dev` runs two processes under `concurrently`: Vite on `5173`, and the [companion's](#the-ai-companion) API server on `8787`, which Vite proxies `/api/*` to.

Those two keys are what the companion needs — `ANTHROPIC_API_KEY` for the observer that interprets spatial change, `OPENAI_API_KEY` for the voice that reads its remarks aloud. They are read by `server/` and never shipped to the browser, which is the only reason a repo that was deliberately backend-free has a backend at all. **Everything else works without them**: with no keys the canvas, the canonical JSON, the event stream and the grounded export are untouched, and the companion degrades to silence rather than to an error.

![The toolbar: four buttons — pointer, hand, Post-it and Relation](docs/images/toolbar.png)

The toolbar carries four tools and only four: **pointer**, **hand**, **Post-it** (`p`) and **Relation** (`r`). Those are the only marks the canonical model can account for — a post-it is a [Node](#four-layers-of-context), a relation is a [Relation](#relations), and the other two are how you read the canvas rather than add to it. The rest of tldraw's toolbar — draw, eraser, arrow, text, note, media, the sixteen geo shapes, line, highlight, laser, frame — stays registered and stays on its keyboard shortcuts; it is only off the toolbar, because a rectangle or a laser stroke would be a mark this model has nothing to say about, and offering one invites work the prototype cannot hear.

The rest of the UI follows the same rule — earn permanent space or be one click away:

| Where               | What                                                                                                                                                                    | Why there                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top centre          | The **companion's** latest sentence, released word by word as the voice says it — and while it works, a hint naming the job it is on. Click it for the full transcript. | The only part of this UI that speaks unprompted, so the only one always visible. tldraw leaves this zone empty.                                                                |
| Top right           | **⋯** → the four switches (contextual fields, AI observation, voice, follow) · **`</>` Canonical JSON** → the [Inspector](#four-layers-of-context)                      | tldraw stacks this zone above the style panel in one column, so anything permanent here pushes the style panel down the screen. Two buttons, and the panels hang beneath them. |
| Right, on selection | Field radius, [relational gravity](#relational-gravity), post-it colours                                                                                                | Selection-scoped, so it belongs in tldraw's own style panel.                                                                                                                   |
| Bottom left         | Zoom                                                                                                                                                                    | tldraw's.                                                                                                                                                                      |

Chrome is built from tldraw's own tokens (`--tl-color-*`, `--tl-space-*`, `--tl-radius-*`, `--tl-shadow-*`) in `src/canvas/ui/theme.ts`, which is what makes the panels follow the editor's theme instead of only matching one of them:

![The same canvas in tldraw's dark theme: the Inspector, the companion chip and the field overlay all following the editor's dark tokens](docs/images/theme-dark.png)

## Scripts

| Script                 | Does                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Both of the next two, together, with prefixed output        |
| `npm run dev:web`      | Vite dev server with HMR (`--host`, also on the LAN)        |
| `npm run dev:api`      | The companion's server on `PORT` (8787), watched by `tsx`   |
| `npm run build`        | Typecheck client + server, then production build to `dist/` |
| `npm run preview`      | Serve the production build locally                          |
| `npm start`            | Run the server against a built `dist/` — one process        |
| `npm run typecheck`    | `tsc --noEmit`, for both tsconfigs                          |
| `npm test`             | Vitest, single run                                          |
| `npm run test:watch`   | Vitest in watch mode                                        |
| `npm run lint`         | ESLint over the repo                                        |
| `npm run lint:fix`     | ESLint with autofix                                         |
| `npm run format`       | Prettier write                                              |
| `npm run format:check` | Prettier check (no writes)                                  |

## Architecture

A **Node** is any entity that can exist on the canvas. `post_it` is the first concrete type, not the abstraction — `image`, `article`, `agent` and the rest join the same model later without the Canvas abstraction changing.

The canonical model owns what things _are_. tldraw renders and manipulates them. Nothing crosses between the two except through the adapter.

```
Canonical Node  ──▶  Tldraw Adapter  ──▶  Tldraw Shape
      ▲                                        │
      └──────────  user interaction  ◀─────────┘
```

tldraw's store is the single runtime store; the canonical Canvas is a derived view over it (`getCanvasDocument`). There is no second store to fall out of step, so undo/redo, IndexedDB persistence and cross-tab sync all keep working untouched. The state tldraw can't express — `createdAt`, `updatedAt`, `createdBy`, `contextualField` — lives in `shape.meta`, which tldraw persists and syncs but never reads. A shape prop would need a schema migration and a `persistenceKey` bump; meta needs neither.

### Contextual field

A Node may declare a `contextualField.radius` in world coordinates. From that, `spatialInfluence.ts` derives how much one Node influences another: linear falloff over centre-to-centre distance, `1` when the centres coincide and `0` at or beyond the radius.

Influence is **derived, never stored**. It is a function of two Nodes' geometry plus the source's radius, so moving a Node changes its context with no state to invalidate — nothing writes an `influence` field into a Node. It is also directional: two Nodes with different radii influence each other by different amounts, without any semantic relation being involved.

Two details worth knowing:

- The radius is optional and **never defaulted** _by the model_. A Node with no field exerts no influence, which is a different claim from a Node with a small one, so `createPostItNode` leaves the key off unless given one and nothing invents a radius on read. The Post-it _tool_ does open a new note with `SUGGESTED_RADIUS` (500) — a canvas whose notes all reach nowhere hides the very thing this prototype is about — but that is the canvas layer making an explicit choice and writing it in, and **Clear** in the style panel returns a note to having no field at all.
- The centre is rotation-aware. `SpatialProperties.rotation` is applied about the top-left corner, so `x + width / 2` is only the centre of an unrotated box.

#### Seeing it

The field was the one piece of spatial state with no visual form — set as a number, read back as numbers, so "does this note reach that one?" meant comparing a distance column against a radius by hand. The **Contextual fields** switch (top right, behind **⋯**) draws it: a dashed circle per Node that has a radius, every one at once, so overlapping reach is something you see rather than compute.

![Two post-its with contextual fields drawn as overlapping dashed reach circles](docs/images/contextual-field-overlay.png)

Selecting a Node **highlights its field**: a solid ring instead of a dashed one, a denser fill, and drawn last so no other circle's translucent fill washes over its outline. Solid-versus-dashed is a difference in _kind_ rather than only in degree, which is what keeps the highlight legible once you zoom out far enough that every outline is a hairline. With several Nodes selected, each of their fields is highlighted.

The overlay is a viewing aid and nothing else. It reads the canonical model, writes nothing, and infers nothing — no lines between Nodes, no distance labels, no shading of intersections. Overlap shows because translucent circles overlap.

Three details carry the design:

- **The circle is centred on `nodeCenter`, not the box midpoint.** Drawn independently it would agree for every unrotated Node and quietly lie about every rotated one — the picture has to be honest about the numbers beside it, so both come from the same helper. Pinned by a test.
- **It renders through `components.OnTheCanvas`**, which sits inside the camera-transformed layer and _behind_ the shapes. Position is therefore in page coordinates with no zoom arithmetic, fields never cover a note's text, and — because `editor.toImage` renders only shapes — the overlay cannot reach a grounded screenshot. That last point is a fact about tldraw's internals rather than our code, so it is verified in pixels rather than trusted.
- **Only the border width divides by the zoom.** The layer is CSS-transformed, so an untouched 1px border would render 4px thick at 4× zoom and vanish zoomed out. A dashed border's dash length follows its thickness, so the dashes need no separate handling.

Visibility lives in a module-scope atom (`contextualFieldVisibility.ts`) because the switch and the overlay are siblings with no common React parent — `components` is declared at module scope so tldraw doesn't remount the editor on every render. It is deliberately not persisted and not canonical: a preference about looking, not a fact about the canvas.

##### Influence scores

Selecting a single Node also badges every Node it is spatially related to with the score, in **both directions**:

```
→ 0.167     how much the selected Node reaches this one
← 0.375     how much this one reaches the selected Node
500 u       centre-to-centre distance — symmetric, so stated once
```

![The selected post-it, with each in-range note badged by its incoming and outgoing influence and the distance between them](docs/images/influence-badges.png)

Both numbers appear even when one is `0.000`, because that zero is information: "its field reaches you, yours doesn't reach it" is a real and easily-missed state. It is the same reasoning that keeps out-of-range rows in `spatialContext` rather than dropping them. A Node out of range _both_ ways gets no badge at all — it isn't affected, and a canvas of zeroes would bury the pairs that carry a signal.

The incoming direction is what makes a Node with **no radius of its own** legible: it exerts nothing, but things still reach it, so selecting it shows `→ 0.000` against real incoming scores instead of an empty canvas.

Three constraints shape the badges:

- **The numbers come from `spatialContext`, never recomputed.** `InspectorPanel` reads from the document so the table and the JSON can't round differently; a badge that did its own arithmetic would be a third answer with no way to tell which of the three was right. Pinned by a test that compares the rendered text to the document's own value.
- **Badges only for a single selection.** `→` and `←` are relative to _the_ selected Node; with two selected there is no referent for either arrow. Multi-selection keeps the field highlights and drops the badges.
- **Badges counter-scale, circles don't.** A circle is a world-space object and should grow with the canvas. Text that grows becomes a billboard, so badges hold a constant size on screen at every zoom.

A score is not a relation and doesn't claim to be one — it reports a derived spatial quantity, exactly as `spatialContext` does. **Proximity still never becomes a relation**; that is what the Relation tool below is for.

### Four layers of context

A `CanvasDocument` deliberately separates what it knows about a canvas into four kinds of claim, so a reader — a person or a model — can tell them apart instead of receiving them pre-mixed:

| Layer                       | Where                                        | Answers                                                        |
| --------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Node spatial state          | `nodes[].spatial`, `nodes[].contextualField` | Where is it, how big, how far does it reach?                   |
| Spatially derived context   | `spatialContext.influences`                  | How far apart are they, how strongly does one reach the other? |
| Explicit semantic relations | `relations`                                  | What did the user connect, call it, and how strongly?          |
| Visual grounding            | `grounding`                                  | Which region of a screenshot is this node?                     |

The first three speak in **canvas coordinates**; `grounding` speaks in **screenshot pixels**. That is why it is its own layer rather than extra fields on `spatial`.

A fifth array, `spatialContext.effectiveStrengths`, is deliberately _not_ a fifth layer. It introduces no new claim about the canvas — every row is a function of the two layers above it, carried alongside the inputs it used — so it is a **reading** of the layers rather than one of them. See [Effective strength](#effective-strength).

Spatial **events** are not a layer either, and for a firmer reason: they are not in the document at all. All four layers describe the canvas at one instant; an event describes a _transition between two_, so it lives in the [event stream](#event-stream) and never in the JSON.

```json
{
	"nodes": {
		"node-a": { "spatial": { "x": 300, "y": 200, "…": "…" }, "contextualField": { "radius": 500 } }
	},
	"relations": {
		"relation-1": { "from": "node-a", "to": "node-b", "gravity": 1, "type": "causes" }
	},
	"spatialContext": {
		"influences": [{ "source": "node-a", "target": "node-b", "distance": 326, "influence": 0.349 }],
		"effectiveStrengths": [
			{
				"source": "node-a",
				"target": "node-b",
				"influence": 0.349,
				"gravity": 1,
				"effectiveStrength": 0.837,
				"strategy": "intent_weighted",
				"relations": ["relation-1"]
			}
		]
	},
	"grounding": {
		"image": { "width": 1998, "height": 1140 },
		"nodes": { "N1": { "nodeId": "node-a", "bbox": [80, 80, 560, 400] } }
	}
}
```

**Proximity never becomes a relation.** Nothing infers `related_to`, or any other type, from two Nodes being close. `relations` is what the user said; `spatialContext` is what the layout implies and nobody named. The reverse holds too: a relation between two distant Nodes creates no influence, and its `gravity` is unmoved by how far apart they are.

### Relations

The **Relation** tool (`r`) draws an arrow from one post-it to another, and that act is the statement: _these two are related_. Double-click the arrow and type `causes`, and the label becomes the relation's `type`.

```json
"relations": {
	"sjWvRRvYRGPbJy9i9h44-": {
		"id": "sjWvRRvYRGPbJy9i9h44-",
		"from": "cdhJU…",
		"to": "QhEky…",
		"gravity": 1,
		"type": "causes"
	}
}
```

`type` is **optional and never defaulted**. An unlabelled arrow means "connected, and the user didn't say why", which is a different claim from `related_to` — inventing that word is precisely the inference this model refuses to make, so an empty label produces no `type` key at all. Same rule as `contextualField`.

**The tool is ours; the shape is tldraw's.** `ArrowShapeTool` is a five-line `StateNode`, so `RelationTool` subclasses it and inherits the entire interaction — drag-to-connect, binding, precise anchors, elbow routing, label editing, re-routing when a Node moves. A bespoke `relation` shape would have meant reimplementing `ArrowShapeUtil` to arrive back at an arrow. `ShapeUtil.canBind()` already defaults to `true`, so post-its were bindable from the start; only the projection was missing.

What separates a relation from a decorative arrow is `meta.relation`, stamped by `getInitialMetaForShape` while the Relation tool is the current one — not the shape type (both are `arrow`) and not the styling, so restyling an arrow never changes what it means. **A plain arrow between two post-its stays decoration.** The toolbar offers only the Relation tool, so that decorative arrow now takes a deliberate `a` to reach; the distinction is a fact about the model either way, not about which buttons are on screen.

Relations are **derived on read**, like everything else: `getCanvasRelations` walks the page's relation arrows and reads their bindings, so there is no second store, and moving a Node, redrawing an arrow or undoing all produce a correct document with nothing to invalidate. Four guards decide what counts, and each is a claim about what a relation is:

| Rejected                   | Because                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| One end loose              | A half-drawn gesture doesn't relate two things, and guessing the other end would invent the claim |
| Bound to a non-Node        | A draw or geo shape isn't a canonical entity                                                      |
| Both ends on the same Node | Follows `calculateSpatialInfluences`, which omits self-pairs                                      |
| Untagged arrow             | Decoration is not an assertion                                                                    |

Nothing in the projection looks at geometry, and nothing in `spatialInfluence.ts` looks at arrows. That is what keeps the two layers answering different questions.

### Relational gravity

A relation carries a **gravity**: how strongly the user says these two are related, `0`–`1`. It is a second strength signal, and the point of it is that it is _not_ the first one:

```text
Spatial influence   → what the arrangement suggests.
Relational gravity  → what the user explicitly expressed.
```

Select a relation arrow and a **Relational gravity** input appears in the style panel. Drawing an arrow starts it at `1`.

So both numbers can describe the same pair, and disagree:

```text
N4 → N1
  distance:           484
  spatial influence:  0.032   ← the layout barely connects them
  relational gravity: 1.0     ← the user says they are strongly related
```

That is not an inconsistency to reconcile — it is the information. The two layers that own these numbers never contaminate each other: **no influence row ever carries a `gravity`, and no relation record ever carries an `influence`.** Collapsing them _in place_ would destroy the only thing this model is trying to preserve — the difference between what the user _stated_ and what can be _inferred_ from how they arranged things — so the Inspector shows them as separate tables.

A reader who wants one number to rank by gets it from a third layer, [`effectiveStrengths`](#effective-strength), which carries both inputs and names the function that combined them. The rule is **never conflated**, not never combined: nothing that was visible before the combined layer existed has been taken away by it.

Gravity is **directional**, like the rest of the record: `from → to` at `1.0` says nothing about `to → from`, which exists only if the user drew that arrow too. Spatial influence stays symmetric in existence (every pair gets a row) and asymmetric in value (it depends on the source's radius).

`gravity` is **required and defaulted**, where `type` is optional and never defaulted. That difference is deliberate: `type` is a _word the user chose_, and inventing one would invent the claim. Gravity is the strength of the _gesture itself_, and deliberately connecting two notes is the strongest assertion the tool offers — so `1` is what the act already meant, not a guess. `clampGravity` in `src/domain/canvas.ts` owns that reading: out-of-range values are clamped, junk falls back to `1`, and a deliberate `0` is kept, exactly as a `contextualField.radius` of `0` is.

It lives in `shape.meta.gravity`, flat beside the `relation` flag rather than nested inside it — `meta.relation` has to stay exactly `true` for `isRelationArrow` to accept it, so nesting would turn every arrow already on a canvas into decoration. An arrow drawn before this field existed reads back at `1.0`.

The schema stays minimal on purpose. No relation vocabulary (`explains`, `supports`, `contradicts`) yet: `from`, `to`, `gravity` and an optional user-typed `type` are what the canvas can honestly report today.

`spatialContext` is assembled in `getCanvasDocument`, the one place a document is built, which is why it needs no invalidation logic and no manual trigger — a move, a resize, a radius change, an addition or a deletion all produce a fresh document. It is **output, not input**: importing a document ignores whatever `spatialContext` it carried and derives a new one from the Nodes.

Every directed pair is emitted, including out-of-range ones at `influence: 0`, so "these are too far apart" stays distinguishable from "this pair wasn't considered". That is `N² − N` entries. Distance is rounded to whole units and influence to three decimals in the document; `calculateSpatialInfluences` stays exact for anything doing further arithmetic.

### Effective strength

Two numbers per pair answers "what is close?" and "what did the user say?", but not "**what should I look at first?**". `spatialContext.effectiveStrengths` answers that third question — one row per directed pair the user connected, carrying both inputs, the combination, and the name of the function that produced it.

![The Inspector's three strength tables: gravity, spatial influence, and the combined effective strength](docs/images/three-strength-tables.png)

The figure is the whole argument in one screenshot. Proximity ranks `Pricing model → Colour of the logo` highest at `0.571`; the user never connected them. `Pricing model → Churn in Q3` sits at half that influence — but it is the pair they drew an arrow between, and effective strength puts it at `0.822`.

```json
"effectiveStrengths": [
	{
		"source": "aaaaaaaa-…",
		"target": "bbbbbbbb-…",
		"influence": 0.286,
		"gravity": 1,
		"effectiveStrength": 0.822,
		"strategy": "intent_weighted",
		"relations": ["relation-1"]
	}
]
```

```mermaid
graph LR
    subgraph derived["derived from geometry"]
        infl["<b>influence</b><br/>0.286<br/><i>spatialContext.influences</i>"]
    end
    subgraph stated["stated by the user"]
        grav["<b>gravity</b><br/>1.00<br/><i>relations</i>"]
    end
    infl -->|"x 0.25"| eff
    grav -->|"x 0.75"| eff
    eff["<b>effectiveStrength</b><br/>0.822<br/><i>strategy: intent_weighted</i>"]

    classDef geo fill:#eef2fb,stroke:#55a,color:#224;
    classDef said fill:#eef7ee,stroke:#5a5,color:#243;
    classDef both fill:#fdf1f7,stroke:#c59,color:#623;
    class infl geo;
    class grav said;
    class eff both;
```

**Multiplication is the one function that cannot work here**, and MVP 0 asks for it by name. `influence × gravity` with gravity normalised to `0`–`1` gives `0.35 × 1.0 = 0.35` — a full-strength relation leaves a distant pair exactly as weak as drawing nothing would have, which fails the requirement in the same paragraph that asks for it. So the amplification lives in the **function**, not in the data, and gravity keeps the `0`–`1` scale `clampGravity` argues for:

| Strategy                    | Function                          | `0.286 / 1.0` | Why it exists                                                          |
| --------------------------- | --------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `intent_weighted` (default) | `infl·(1−w) + grav·w`, `w = 0.75` | `0.822`       | Intent counts 3× proximity, and High+High still outranks Low+High      |
| `product`                   | `infl × gravity`                  | `0.286`       | The literal formula — kept so its failure is a test, not an argument   |
| `lift`                      | `infl + grav·(1 − infl)`          | `1.0`         | Amplifies, but saturates: every default-gravity pair reaches exactly 1 |

Which is why the strategy **travels with every row**. `INTENT_WEIGHT = 0.75` is a calibration guess — nothing consumes these numbers yet, so there is nothing to tune it against — and a reader who disagrees can see which function they are disagreeing with instead of having to reverse-engineer it.

Each row is also **reproducible from itself**: it is combined from the same rounded `influence` printed beside it, so `strategy(row.influence, row.gravity)` returns `row.effectiveStrength` exactly. A row combined from a hidden extra three decimals would not survive that check, and checking is the point.

Only connected pairs get a row. A pair with no arrow has no intent to combine, and emitting one with `gravity: 0` would invent the claim — **absent is not zero here either**. A pair at `influence: 0` _does_ get a row, because "explicitly related despite distance" is the state the whole separation exists for. Two arrows the same way have their gravities **summed and clamped**: saying a thing twice cannot mean it less, which is what rules out averaging.

### Change detection

`diffCanvas(before, after)` is the only part of the model with any notion of _before_, and it acquires one the cheapest way available: by being handed two documents. **The function itself keeps no listener, no log and no history** — a caller that wants change detection holds its own snapshots. That is what keeps `CanvasDocument` a pure function of the store, with nothing to invalidate.

Exactly one caller does hold them: `registerSpatialEvents`, which turns this diff into the [event stream](#event-stream). The split is the point — the comparison stays pure and testable in `src/domain`, and the snapshot bookkeeping lives in the adapter, where a store subscription belongs.

It **reads** the derived layers rather than recomputing them, so a diff can never report a number that disagrees with the JSON the caller is holding. Comparison is exact equality on values the document already rounded, which makes the epsilon self-evident: a change too small to appear in the document cannot appear in a diff of it.

Eight change kinds come back — the seven the requirement implies, plus `relation_gravity_changed`, which it omits although the style panel already permits it:

```text
node_created · node_deleted · node_moved · contextual_field_changed
relation_created · relation_deleted · relation_rebound · relation_gravity_changed
```

Dragging a connected note away produces exactly the reading the requirement asks for — influence collapses, gravity does not move, and the combined number barely dips:

```json
{
	"changes": [
		{
			"kind": "node_moved",
			"node": "bbbbbbbb-…",
			"before": { "x": 680, "y": 400 },
			"after": { "x": 1520, "y": 400 }
		}
	],
	"pairs": [
		{
			"source": "aaaaaaaa-…",
			"target": "bbbbbbbb-…",
			"distance": { "before": 500, "after": 1340, "delta": 840 },
			"influence": { "before": 0.286, "after": 0, "delta": -0.286 },
			"effectiveStrength": { "before": 0.822, "after": 0.75, "delta": -0.072 }
		}
	]
}
```

`gravity` is **absent from that pair**, because it did not change. The arrow is still there at full strength; only the layout moved.

Three decisions are worth naming:

**`node_moved` compares centres, not corners.** `spatial.rotation` is applied about the unrotated box's top-left, and a resize changes width or height — so a rotation and a resize each move the centre, and therefore every distance in the document, while `spatial.x`/`y` may not have changed at all. One kind covers all three honestly; comparing raw coordinates would miss two of them.

**`relation_rebound` is an update, not a delete plus a create.** `RelationId` derives from the arrow's shape id, which survives dragging one end onto a different note — so the relation's identity persists through a rebind, and the diff can say so.

**Actions and consequences are two lists, not a tree.** The requirement's examples read as `A moved closer to B → influence increased`, and for a single action that join is recoverable. What the diff must not do is _assert_ it: when two nodes both move, deciding which one caused a given pair's influence to rise is an inference, and inferring causality is exactly what the requirement rules out. So `changes` says what the user did, `pairs` says what the numbers did, and the arrow between them is left to a reader who can see whether it is warranted.

### Event stream

[`diffCanvas`](#change-detection) answers _what is different_ between two canvases. The event stream answers the next question — _what just happened_ — as an ordered, subscribable sequence a debug panel can render one line at a time, and [the companion](#the-ai-companion) consumes without ever reconstructing spatial state from a screenshot.

It adds no new truth. `deriveEvents(diff)` restates a diff's two lists as events: the eight change kinds become **structural events**, and each pair's influence delta is _classified_ into the **spatial events** the diff carries but does not name.

```text
structural   node_created · node_deleted · node_moved · contextual_field_changed
             relation_created · relation_deleted · relation_rebound · relation_gravity_changed
spatial      field_entered · field_exited · influence_changed · proximity_changed
```

A pair's influence is the whole classifier. Crossing zero is a boundary — `field_entered` when influence rises from `0`, `field_exited` when it falls to it. A change with both ends inside the field is `influence_changed`. Crossing a `0.66` / `0.33` band edge while still in range is `proximity_changed` (`strong` / `weak`), which can accompany an `influence_changed`. A pair that only _appeared_ or _vanished_ is a created or deleted node — reported structurally, never as a spurious crossing. Every spatial event carries `previous` and `current` (`{ distance, influence }`), so a transition is legible without holding the surrounding snapshots.

The stream itself is deliberately small: an in-process, subscribable buffer, **no WebSockets**. `registerSpatialEvents(editor, stream)` is the one place the pure `diffCanvas` is driven by live edits — it holds the previous document, re-derives on every document-scope store change, diffs, and emits. In development the running stream is on `window.spatialEvents`, and `window.seedDemoScene()` lays out the walkthrough below. (The subscription is disposed on unmount, so StrictMode's double-mount does not attach two.)

**The walkthrough (`window.seedDemoScene()`, then drag B).** Three post-its; A carries a 500-unit field, B starts outside it, C sits inside. Drag B in from the right and the stream fills — `field_entered`, then `influence_changed` and `proximity_changed` as it strengthens — and ends on the state that is the whole point: B dragged far past the boundary, its influence gone, and the A → B relation still standing at full strength.

![The event stream after the walkthrough: B dragged out of range with influence 0, the A→B relation intact at gravity 1.00, and field_exited / node_moved / relation_created in the event log](docs/images/event-stream.png)

The panel shows all three signals diverging at once: spatial influence `A → B` is `0.000` at distance `1500`, yet relational gravity holds at `1.00` and effective strength stays `0.750`. The event log records how it got there — `relation_created`, then `field_exited` with `infl 0.70 → 0.00` — and never a `relation_deleted`, because moving a node cannot revoke a claim the user made. Proximity and intent are independent, and the stream reports them independently.

### The AI companion

The stream was built for one consumer, and this is it. `src/companion/` subscribes, groups events into episodes, and — when a pause reveals a change worth interpreting — asks a model whether there is anything to say. It is the only part of the app that speaks without being asked.

```mermaid
flowchart LR
    stream[["spatialEventStream"]] --> rec["createEpisodeRecorder<br/><i>2s idle → fold</i>"]
    rec --> gate{"isTrivialEpisode"}
    gate -.->|"trivial"| quiet["silence"]
    gate -->|"worth asking"| ctx["readEpisodeContext<br/><i>ids → note text</i>"]
    ctx --> obs["/api/observe<br/><i>claude-sonnet-5</i>"]
    obs -.->|"speak: false"| quiet
    obs -->|"speak: true"| tx["transcript"]
    tx --> spk["/api/speak<br/><i>gpt-4o-mini-tts</i>"]
    spk --> bar["CompanionBar<br/><i>words as spoken</i>"]

    classDef built fill:#eef7ee,stroke:#5a5,color:#243;
    classDef hush fill:#f4f4f5,stroke:#999,color:#444;
    classDef seam fill:#eef2fb,stroke:#55a,color:#224;
    class stream,rec,gate,ctx,tx,bar built;
    class obs,spk seam;
    class quiet hush;
```

![The companion's top-centre chip carrying its latest remark, with the transcript open beneath it showing both — one about three notes clustering, one about the arrow drawn to a note far across the canvas](docs/images/companion-remark.png)

Both remarks in that transcript are what the model actually said to the canvas underneath them. It reads newest first, so the one on top came second — an arrow drawn to a note on the far side of the canvas, which is the case the [separation of signals](#relational-gravity) exists for: proximity says those two are unrelated, and the user has just said otherwise. The one below it came first, when three notes drifted into one another's fields.

**An episode is the unit, not an event.** A drag emits a `node_moved` and an `influence_changed` per node per store tick, so handing the model raw events would be handing it hundreds of near-identical records. `createEpisodeRecorder` buffers the stream and finalizes after `EPISODE_IDLE_MS` (1.2s) of quiet; `buildEpisodeSummary` then folds the buffer to net change — per directed pair, the first sighting fixes `before` and the last advances `after`, keeping every distinct transition it passed through. A `node_moved` folds the same way, origin to destination. Both are pure functions in `src/domain/episode.ts`, testable without a clock or a network.

**Significance is decided twice, by two different kinds of judge.** The local gate (`isTrivialEpisode`) is cheap and deliberately dumb: any structural change other than a bare move is always interesting, and failing that an episode is trivial when every pair's net influence shift stays under `TRIVIAL_INFLUENCE_EPSILON` (0.05). It exists only to keep genuine noise off the wire. Everything that survives is worth _asking_ about — and the model then decides whether it is worth _speaking_ about. **Silence is a first-class answer**, returned as structured output (`{ speak, comment }`) rather than detected in prose, and it is the normal outcome for most episodes.

**The observer is handed meaning, not ids.** An episode names nodes by `NodeId` — a tldraw shape id — which is all the domain should carry and nothing a model can interpret. `readEpisodeContext` (in the adapter, because reading the canvas is a canvas concern) resolves those ids to the notes' own text, and adds every relation currently touching them, whether or not this episode created it. That second part is what makes "you pulled them apart but kept the connection" legible at all: the episode itself only reports that influence fell, and the arrow may have been drawn ten episodes ago.

**Four behaviours in the orchestrator are worth naming**, all in `createCompanion`:

- **Three switches, three different jobs.** `observationEnabled` gates the model call; `voiceEnabled` gates only playback; `followEnabled` gates whether the canvas moves to whatever a remark is about. Off/off is silent; on/off fills the transcript without speaking. Observation is re-read after the await, because a user who turns it off mid-thought is asking not to be spoken to, and the answer in hand was authorised by a setting that no longer holds. Follow is last and refusable because it is the most assertive of the three: a sentence can be ignored while you carry on working, a camera move cannot.
- **Observations queue; the voice is serial.** Every closed episode is asked about at once, and the answers are spoken one after another in the order the gestures happened. See [a queue, not a thought](#a-queue-not-a-thought) below — it is the one behaviour here that changes what the model is asked, not merely when.
- **A remark can be dropped, but only at the door.** A thought is never called off for the canvas having moved; it is asked, at the last moment silence is still free, whether it is too late or no longer true.
- **The text arrives with the voice.** Deciding what to say and synthesising it are two waits of a few seconds each. Announcing the remark after the first one meant the user read it, finished, and only then heard it read aloud — so the thinking hint stays up through synthesis, and the words are released as playback reports its progress (`spokenPrefix` in `reveal.ts`, position-weighted since an mp3 carries no word timings). The transcript is written as the remark takes the voice rather than when the model answered — a thought dropped at the door was never said — but still _before_ playback, so it survives voice being off or synthesis failing.

**Both API keys live in `server/`.** That is the whole reason this repo has a backend — five Hono routes, `/api/observe`, `/api/suggest`, `/api/reflect`, `/api/digest` and `/api/speak`, with the prompts and the model choice server-side so the persona can be tuned without shipping anything to the browser. Every route **fails safe**: a malformed body, a missing key or a 400 from the SDK all degrade to that agent's own safe answer — silence, a decline, an empty reflection — rather than an error at the user.

**Two layers, not one board.** `/api/digest` reads the whole board and derives a standing _understanding_ of it — its themes, a one- or two-sentence reading, the narrative the session has been circling, and what it leaves unresolved — which the client keeps and hands back to the observer, the suggester and the reflection alongside whatever just happened. So each of those three is shown the board as it currently is _and_ a reading of what it means, and is told, explicitly, how stale that reading is (`driftSince`). Between the two sits a triage every agent applies: does this change FIT the understanding (already accounted for, usually silence), EXTEND it (name something the reading didn't hold, worth a word), or CONTRADICT it (the reading is now wrong, which is the most worth saying)? The understanding is never itself a topic — an agent that summarises it back to the user has failed the same way one that recites an influence score has. A missing or stale digest costs nothing: every field is optional, and an agent with no understanding behaves exactly as it did before `/api/digest` existed.

The observer ran with thinking _disabled_ for a long time, on the reasoning that `max_tokens` caps thinking plus text and a truncated response parses to nothing — indistinguishable from a considered silence. Measuring it (`npm run eval`) showed the opposite problem. Structured output constrains generation to valid JSON, so reasoning the model could not place had nowhere legal to go and was absorbed into the only string open at the time: the remark itself. The result was schema-valid decisions carrying things like `"…worth noticing that tension.}  Actually: {"` — up to 1040 characters of leaked scaffolding, on its way to the voice. Turning thinking on removed the leak, did not measurably cost latency, and cut the longest remark from 654 characters to 169. A second layer (`isCleanRemark`) now rejects a remark that reads as spillage rather than speaking it, because a schema guarantees shape and not sanity.

**The pause is real, and it is measured.** Against the live APIs, warm, re-measured 2026-08-28:

| Stage                                  | Cost                           |
| -------------------------------------- | ------------------------------ |
| The idle pause before the episode ends | 1.2s at rest, up to 4s (below) |
| `/api/observe` (`claude-sonnet-5`)     | 3.1s median (2.97 – 3.57)      |
| `/api/speak` (`gpt-4o-mini-tts`)       | 1.6s to first sound            |

Summing those medians gives ~6.0s from "user stops dragging" to first sound, with the thinking hint covering the last ~4.7s. A live gesture measured end to end came in faster — 1.17s to the episode closing, a decision back at 3.19s — because the model call is the variable term and a simple episode is nearer 2s than 3s. Call it 5–6s, most of it the hint.

**Almost all of the hint is the model call, so the hint is the hard part.** The idle pause is the only stage that was cheap to cut, and it sits _before_ the hint appears — so lowering it to 1.2s made the companion react sooner without shortening the wait the user actually watches. (It is also why cutting it was not the whole answer: a shorter pause starts the same 4.7s pipeline sooner, which is a separate problem from the pipeline being long enough for the canvas to change underneath it. See [a queue, not a thought](#a-queue-not-a-thought).) Inside the hint, three things were measured and two were rejected:

- **`OBSERVER_MODEL=claude-haiku-4-5` is still the one large lever** — about 2s faster, at a cost in judgement. Sonnet is kept deliberately.
- **`output_config.effort` is not a lever, and the way that was established is the point.** Measured three times with improving method, the apparent win shrank each time: 0.66s with the levels timed one block after another, 0.44s once the levels were interleaved so API drift hit them equally, and **0.14s** once the sweep ran over three different episodes instead of one. `medium` is also bimodal (2.00 – 3.56s) where `low` is steady, which is how a lucky block ordering produced the first number. Left unset — at `high` the judgement is best and the latency is the same. A lever that keeps shrinking as the measurement improves was never there.
- **Streaming the mp3 was built, measured, and reverted.** The route reaches its first byte at ~1.1s and its last at ~1.8s, so forwarding bytes as they arrive looks like a free second. It is not: Chrome buffers about 1.4s of a chunked clip before it produces sound, so the measured saving is only 0.27s (1.64s → 1.37s to first sound, A/B in one browser). Worse, a chunked mp3 reports `duration` as `Infinity` for the _whole_ clip, never just the opening — so the word reveal loses its only exact timebase and has to estimate, and the fit's ±11% error is ±0.66s of drift between a word appearing and being spoken. That is far coarser than the `timeupdate` the per-frame sampler was chosen over. 0.27s is not worth desyncing the thing the reveal exists to do.

Prompt caching is not a lever either: the cacheable prefix is the system prompt alone at ~500 tokens, and `claude-sonnet-5` will not cache below 1024, so a `cache_control` marker would silently do nothing.

#### A queue, not a thought

The table above has a consequence the latency work missed. If it takes ~4.7s to turn a closed episode into a spoken remark, then a remark is only ever about a canvas as it stood 4.7s ago — and the pause that decided when to start is a guess about one user's rhythm applied to every user. Guess short and a pause mid-arrangement is read as the end of a gesture; guess long and the companion says nothing worth hearing because it hears nothing.

The first answer to that was to **kill** the thought: the moment the user touched the board, the request was aborted, its events carried into the next episode, and the pause stretched past the quiet that had fooled it. It was a defensible bet — a remark about a canvas that has moved on is worse than silence — and it was the wrong one. Keep arranging and the companion had nothing to say about any of it except the last thing you did. The interesting burst is exactly the burst it threw away.

So the pipeline behaves like a queue of tasks instead. Every gesture gets a slot, the thinking happens in parallel, and the remarks are spoken one after another in the order the gestures happened. Watching it work through three things it noticed is more companionable than watching it forget two of them — and the backlog is visible, with an × on each chip, because a queue you can only watch is a status readout and a queue you can steer is a control.

![The companion's top-centre strip: the thinking hint naming the thought in hand, and a chip beneath it naming the gesture waiting behind it, each dismissable](docs/images/companion-queue.png)

```mermaid
flowchart TD
    A["episode closes<br/>(canvas quiet for the pause)"] --> Cap{"queue full?"}
    Cap -- "yes" --> Carry["carry the events forward<br/>no request, no cost"]
    Carry -.-> A
    Cap -- "no" --> B["ask the observer<br/>(all of them at once)"]
    B --> Q[["queue, in gesture order"]]
    Q --> H{"at the front:<br/>too late, or no<br/>longer true?"}
    H -- "yes" --> D["drop it, unsaid<br/>and unrecorded"]
    H -- "no" --> G["transcript, then voice<br/>— nothing else speaks until it ends"]
    G --> S["ease the pause<br/>halfway back"]
    D --> P["was the user straight back?<br/>then the pause was too short"]
```

Four things make that work, and each is a place the old design had nothing:

- **The pump is the only thing that speaks.** Not a convention — a structural guarantee. An observation, a proactive grouping, an on-demand reflection and the comment after an accepted edit all _enqueue_; none of them touch the voice. Two of them used to speak directly, which under a queue means two clips talking over each other. A direct request jumps the line rather than talking beside it: it takes the next turn, never the current one, because cutting a sentence off mid-word is the thing this loop has always refused to do.
- **A remark is dropped at the door, not in flight.** Two rules, and age comes first because it is the only one that cannot be wrong: nothing records what a remark actually _asserted_, so `isStillTrue` reads the episode as a proxy and is blind to a remark about the board as a whole. Age catches those too. `isStillTrue` is the narrower second rule, and it catches the specific embarrassment — naming a note since deleted, or describing a drag since dragged back. It compares against the _rounded centre_ a `node_moved` was recorded in, not `spatial.x/y`, because those are two different frames and mixing them fails silently.
- **The cap sits above the model call.** Four thoughts, checked before the request rather than before the chip — a cap enforced after the request is a display cap and an uncapped bill. Four is not a UI choice either: a remark is ~7s of speech plus ~1.6s of synthesis, so four deep puts the last one nearly thirty seconds behind the gesture that produced it, which is already at the edge of being worth hearing. An overflowing gesture is not lost; it waits for a slot and is folded into the thought that takes it.
- **The pause still learns, from a narrower signal.** `createIdleBackoff` existed to make kills rarer, and nothing is killed now — but it is also the only thing throttling what a fidget costs in paid calls, so it stays. It fires on the one pair of conditions that still means _the pause was too short_: a thought dropped as no longer true, **and** a user who came straight back after the pause fired. Either alone says something else. A prompt return whose remark still held says the pause was fine; a remark stale a minute later says the board moved on, not that the timing was wrong.

The ceiling is still the load-bearing number. Total quiet needed for a remark to reach the user is the pause plus that 4.7s — 5.9s at rest, 8.7s at the cap — so a policy that escalated freely would escalate itself into permanent silence. It is shown, not hidden: the companion settings popover reads `Pause 2.4s · 4 dropped`, because a number that moves on its own and cannot be seen is indistinguishable from a bug. It is deliberately not adjustable; the point of the mechanism is that it works this out better than a slider would.

**One thing the queue cost, and it was worth naming.** Speaking in turn only works if the voice reports when it has stopped, and it did not: `stop()` ends a clip with `audio.pause()`, which fires no `ended` event, and a refused `play()` fires nothing at all. Three of the five ways a clip can end were silent, so a serial pump would have deadlocked the first time anything interrupted anything. `VoiceClient` now reports the ending on every path, exactly once — and the request carries the same twenty-second ceiling the observer already had, since a hung `/api/speak` used to cost a stuck hint and now would cost every remark after it.

**What did shrink was the remark.** Chasing the latency turned up a separate problem: "one or two short, conversational, observational sentences" was too loose an instruction, and remarks were averaging 168 characters — every one of them over 140 — with the longer ones narrating what the user had just done rather than what it might mean. Replacing that line with an explicit ceiling and three examples of the right register took the mean to **114 characters, none over 140**, with no example ever parroted back. Since the voice speaks at roughly 16 characters a second, that is about three and a half seconds less talking per remark, which does more for how long the companion _feels_ than any of the levers above. Examples beat prohibitions here: the earlier attempt to get brevity by lowering `effort` made remarks **longer**, because it bought its speed by loosening adherence to exactly this paragraph.

### Grounded screenshot

The other three layers speak in canvas coordinates — they say where a Node is and what reaches it. What none of them can say is which _pixels_ it occupies. A model handed a screenshot and the JSON has to work that out from world coordinates, and inferring it is exactly the kind of guess the rest of this design removes.

`grounding` closes that gap, and the **Grounded screenshot** button in the Inspector panel exports the image it describes: a PNG of the canvas with every Node outlined and labelled `N1`, `N2`, `N3`.

![The exported PNG — each post-it outlined in pink and labelled N1, N2, N3, the relation arrow badged with its gravity, and the contextual-field overlay deliberately absent](docs/images/grounded-screenshot.png)

```json
"grounding": {
	"image": { "width": 1440, "height": 1477 },
	"nodes": {
		"N1": { "nodeId": "aeb30231-…", "bbox": [80, 80, 560, 400] },
		"N2": { "nodeId": "cb19cf1f-…", "bbox": [880, 160, 1360, 480] }
	}
}
```

The same Node is then reachable three ways: **semantic** (`content.text`), **spatial** (`spatial`, plus the derived `spatialContext`), and **visual** (`grounding.nodes[].bbox`).

`grounding` indexes **relations as well as Nodes**, keyed `R1`, `R2`… on the same terms:

```json
"relations": {
	"R1": { "relationId": "rel-a", "bbox": [344, 157, 1837, 1200], "badge": [887, 390] },
	"R2": { "relationId": "rel-b", "bbox": [560, 422, 3152, 1708], "badge": [2108, 1566] }
}
```

It was argued out at first, on the grounds that `relations` already names both endpoints by node id and `grounding.nodes` maps `N1`, `N2`… back to those ids — so the arrow in the picture was already joinable to the relation describing it. That is true of an arrow's **identity** and silent about its **pixels**, which is the one question this layer exists to answer. A model looking at two crossing curves cannot tell which is which from endpoint ids alone.

Leaving it out also forced the badge to be re-derivable from node centres, and [that is what broke it](#why-the-badge-is-measured-rather-than-derived).

**`spatial` and `grounding.bbox` are different coordinate systems, and the separation is the point.** `spatial` is the canvas — world units, an origin the camera can't move, unchanged by any export. `bbox` is one screenshot — pixels from that image's top-left, meaningless without the `image` it came with. A Node 900 world units down the canvas is 1880px down a 2×-scale PNG; conflating the two is the mistake this layer makes impossible.

`bbox` is `[x1, y1, x2, y2]` — opposite corners, not `[x, y, width, height]` — rounded to whole pixels, since a screenshot has no sub-pixel position to point at.

The layer is an _index, not an interpretation_. Every mark on it names something the JSON already states about something the user made: a Node's region, or the gravity they gave an arrow. Nothing _derived_ is drawn — no influence rings, no distance markers, no lines between Nodes that have none — because those claims live in `spatialContext`, and putting them on the image would mix a reading of the canvas into what is meant to be a lookup table between pixels and ids. Only the badges are filled, so the canvas underneath survives intact.

#### Why the badge is measured rather than derived

A relation's badge reads `R1 g 0.60`. The `g` is load-bearing, since an image already carries distances and sizes and a bare `0.60` beside an arrow could be read as any of them. The `R1` is load-bearing for a second reason, and it took a real export to notice: two relations at the default gravity produced two badges both reading `g 1.00`, so a reader could see _that_ there were two and never which was which.

The position used to be the **midpoint of the two Nodes' centres** — derived rather than measured, so a reader could recompute it from `nodes[].spatial` and check the badge instead of trusting it. That re-derivability was real, and it was bought at too high a price:

![Four post-its with two curved relation arrows, each badged R1 and R2 on the curve itself, and both arrows fully inside the frame](docs/images/grounded-relations.png)

Those arrows are _bent_. A bend leaves the straight line between the two centres, so the derived midpoint is a point the curve never passes through — in the export that exposed this, both badges floated in open canvas, one of them directly above an unrelated Node's `N3` label where it read as that Node's gravity. **A badge naming the wrong thing is worse than one whose position has to be stated.**

So the arrow's real path is measured — `getArrowInfo` gives a point on the arc, and an elbow route is walked to half its arc length — and `grounding.relations[].badge` says where the badge ended up. The check a reader could do by recomputing, they now do by reading.

The same measurement fixed a second defect in that export. The export box was sized to the Nodes, while every shape on the page was drawn into it, so an arrow bowing outside the notes was **cut off at the edge of the PNG** with the rest of it still drawn. `groundingProjection` now unions the arrows' own bounds: in the canvas above the lowest note ends at y 780 and the lower arrow reaches y 874, which is 188px of image that used not to exist.

Reading arrow geometry means the grounding layer needs something the canonical model can't supply — a curve's position is not a function of its endpoints. That work lives in `src/canvas/adapter/relationGeometry.ts`, the layer that is allowed to see both sides, and it hands the pure layer plain world-space numbers. It also **never throws**: `getCanvasDocument` runs inside a reactive computed, and measuring an arrow resolves its label's fonts, which fails outright on an editor without `textOptions`. An arrow it can't measure is omitted, so the cost of that failure is one missing badge rather than the canvas.

Six things about it are worth knowing:

- **`grounding` is derived, never stored** — assembled in `getCanvasDocument` beside `spatialContext`, recomputed on every read, and **output, not input**: importing a document ignores whatever `grounding` it carried. It describes the screenshot the canvas _would_ export right now, which is knowable rather than guessed: the bounds come from the Nodes and the pixel ratio is fixed at 2, so `image` is `floor(bounds × 2)`. The export then measures the bitmap it actually produced and substitutes that, so a saved PNG + JSON pair always describes itself. A test pins the two together — the prediction and the measurement come out equal.
- **`N1` is a position, not an identity.** Moving a Node can renumber every label; the node id remains the only stable handle. A label exists so a short token can be pointed at in an image.
- **A rotated Node's `bbox` is looser than its outline.** Four numbers can't express a rotation, so the bbox is the smallest axis-aligned box containing the Node, while the outline drawn on the image follows the rotation. A test pins the bbox to the drawn quad's corners so the two can never disagree about which Node they describe.
- **The image covers every Node, not the viewport.** Bounds come from the Nodes themselves, expanded by `GROUNDING_PADDING`, so a Node parked far off screen is still in the picture. Grounding something that isn't visible would be worse than not grounding it.
- **The scale is measured, never assumed.** `toImage` reports the _logical_ size it rendered at, while `scale`, `pixelRatio`, flooring and the browser's maximum canvas size all sit between that and the actual blob. `imageScale` derives pixels-per-world-unit from the decoded bitmap, and throws if the height doesn't follow from the width — a box in the wrong place is worse than no box. Note it checks the _height in pixels_ rather than comparing the two axes' implied scales: the axes are floored independently, so those scales never quite agree, and the disagreement grows with the aspect ratio. Judging it against a fixed pixel budget rejects a wide canvas for being wide.
- **Only the export validates.** `buildGrounding` deliberately checks nothing, because `getCanvasDocument` runs inside a reactive computed — anything thrown while deriving a layer takes the editor down rather than showing a bad number. This follows `calculateSpatialInfluence`, which returns `0` for every degenerate input for the same reason: an unvalidated canvas is a normal state to be in, not an error to interrupt a render for.

## Layout

```
server/                        Two routes, so the API keys never reach the browser
  index.ts                     Hono app — /api/observe, /api/speak, dist/ in production
  observe.ts                   One episode in, a speak / stay-silent decision out
  prompt.ts                    The system prompt, the decision schema, episode → prose
  speak.ts                     Text-to-speech synthesis
src/
  main.tsx                     React entry point
  App.tsx                      Thin shell, renders <Canvas />
  index.css                    Global styles + tldraw.css import
  domain/                      The canonical model — no tldraw imports, ever
    node.ts                    CanvasNode, spatial/visual/metadata, createPostItNode
    canvas.ts                  CanvasDocument — the four layers, Relation, clampGravity
    grounding.ts               Grounding types — screenshot pixels, not canvas units
    spatialInfluence.ts        Node centre, distance, influence, buildSpatialContext
    effectiveStrength.ts       The one place the two strength signals combine
    canvasDiff.ts              diffCanvas(before, after) — the only notion of "before"
    events.ts                  deriveEvents — a diff restated as ordered events
    eventStream.ts             In-process subscribable buffer; the app-wide singleton
    episode.ts                 Events folded into one gesture + the local significance gate
    index.ts                   Barrel — the @/domain import surface
  companion/                   The AI observer's loop — the event stream's one consumer
    companion.ts               episode → gate → observe → queue → speak
    thoughtQueue.ts            Where a thought goes, whether it is still worth saying, its label
    companionState.ts          Module atoms: the switches, the stage, the transcript, the queue
    observerClient.ts          The seam to the model — POST an episode, get a decision
    voiceClient.ts             The seam to TTS — POST text, play audio, report progress and the end
    reveal.ts                  Which words have been said at a given fraction of playback
  canvas/
    Canvas.tsx                 The <Tldraw /> wrapper — persistence, onMount hook
    config.tsx                 Module-scope shape utils, tools, UI overrides and toolbar
    adapter/                   The only code that knows both sides
      adapter.ts               shapeToNode / nodeToShape — the round-trip pair
      ids.ts                   NodeId ⇄ TLShapeId
      richText.ts              plain text ⇄ rich text, kept pure
      relations.ts             arrow ⇄ Relation, gravity reads/writes, rebuilding on import
      relationGeometry.ts      Measures an arrow's drawn path in world space; never throws
      canvasView.ts            getCanvasDocument(editor), useCanvasDocument()
      metadata.ts              createdAt / updatedAt side effects
      contextualField.ts       setContextualFieldRadius(editor, ids, radius)
      spatialEvents.ts         Drives diffCanvas from live edits — the one subscription
      episodeContext.ts        An episode's ids → note text + the relations that exist
      episodeValidity.ts       The live board in the terms one episode described it in
    dev/
      seedScenario.ts          The walkthrough scene, behind window.seedDemoScene()
    shapes/                    The tldraw projection of a post_it
      postItShape.ts           Shape type + guard (type-only tldraw imports)
      postItStyles.ts          Raw-hex StyleProps for fill / stroke / text
      PostItShapeUtil.tsx      Rendering, geometry, resize, text editing
      PostItTool.ts            Creates the Node first, then projects it
      RelationTool.ts          Subclasses ArrowShapeTool; tags what it draws
    grounding/                 Node ⇄ pixels, for the grounded screenshot
      visualId.ts              assignVisualIds — N1/N2/N3 in reading order
      projection.ts            World ⇄ image: bounds, rotated corners, bbox, measured scale
      grounding.ts             deriveGrounding / buildGrounding — image size + bboxes
      annotationLayer.ts       Draws the outlines, labels and gravity badges onto a 2D context
      groundedExport.ts        toImage, composite, save the PNG + JSON pair
    ui/
      theme.ts                 Panel chrome, built from tldraw's own theme tokens
      InspectorDock.tsx        The top-right rail: two buttons, Inspector beneath
      InspectorPanel.tsx       Live canonical JSON, relation + influence tables, grounded export
      EventLogPanel.tsx        Live view of the spatial event stream, newest first
      CompanionBar.tsx         The top-centre chip: latest sentence, thinking, transcript
      CompanionQueue.tsx       The backlog behind the bar, one dismissable chip per gesture
      CompanionFocusCamera.tsx Follows the spotlight with the camera; renders nothing
      CompanionTranscriptPanel.tsx  Everything the companion has said this session
      CompanionControls.tsx    The AI observation and Voice switches
      AgentThinkingIndicator.tsx  The hint naming the job the companion is on
      ViewSettingsPopover.tsx  The ⋯ button's four switches
      PostItStylePanel.tsx     Colour controls, and hosts the field and gravity controls
      ContextualFieldControl.tsx  Radius input for the selection
      RelationGravityControl.tsx  Gravity input for the selected relations
      ContextualFieldOverlay.tsx  Dashed reach circles, drawn behind the shapes
      InfluenceBadges.tsx         Both directions' scores, on the affected notes
      ContextualFieldToggle.tsx   The show/hide switch
      contextualFieldVisibility.ts  Module atom shared by the two above
```

Imports resolve `@/` to `src/`, e.g. `import { Canvas } from '@/canvas/Canvas'`.

**`src/domain` must never import tldraw.** That's the whole point of the split, so ESLint enforces it rather than leaving it to code review.

Test files (`*.test.ts`, `*.test.tsx`) sit next to the code they cover and are left out of the tree above for brevity. For the full file-by-file map — every module, its key exports, and the three test layers — see [`CODEMAP.md`](./CODEMAP.md).

## Where to add things

- **A new node type** → add it to `NodeType` in `src/domain/node.ts`, give it a shape util and tool under `src/canvas/shapes/`, and extend the adapter. The `Canvas` model itself shouldn't need to change.
- **Prototype logic that needs the editor** → the `onMount(editor)` callback in `src/canvas/Canvas.tsx`.
- **A new custom shape** → copy `src/canvas/shapes/PostItShapeUtil.tsx`, then register it in `customShapeUtils` in `src/canvas/config.tsx`.
- **A new custom tool** → copy `src/canvas/shapes/PostItTool.ts`, register it in `customTools`, add it to `uiOverrides` for its label and shortcut, and add a `<ToolbarItem tool="…" />` to the `Toolbar` override so it actually appears (all three in `src/canvas/config.tsx`). That override names every button on the toolbar rather than calling `<DefaultToolbarContent />`, which is what keeps tldraw's own tools off it — they stay registered, and stay on their keyboard shortcuts.
- **A different way of combining the two strength signals** → add a `CombineStrategy` to `STRATEGIES` in `src/domain/effectiveStrength.ts` and pass it to `buildSpatialContext`. Nothing else needs to know: the name travels with each row, so the JSON says which function produced it. Don't reach for a new `gravity` scale to get amplification — that is what the strategy is for.
- **Change detection over time** → `diffCanvas(before, after)` in `src/domain/canvasDiff.ts`. Capture documents with `getCanvasDocument(editor)`; it reads the derived layers rather than recomputing them, so it can't disagree with the JSON you already have. For changes as they happen, subscribe to the [event stream](#event-stream) instead of holding your own snapshots.
- **A new event type** → add it to the `SpatialEvent` union in `src/domain/events.ts` and emit it from `deriveEvents`, which is pure and takes a `CanvasDiff`. If the transition isn't visible in a diff, the gap is in `canvasDiff.ts`, not here — add the change kind or pair delta first, so the event stays a restatement of something a reader could already see in the JSON. Give it a line in `describeEvent` in `src/canvas/ui/EventLogPanel.tsx`; the switch is exhaustive, so TypeScript will fail the build until you do.
- **Something that watches the canvas** (an agent, a logger, an experiment) → `spatialEventStream.subscribe(fn)` from `@/domain`. Don't add a second store subscription: `registerSpatialEvents` is deliberately the only one, so every consumer sees the same ordered events.
- **What the companion says, or how it judges** → `SYSTEM_PROMPT` and `renderEpisode` in `server/prompt.ts`. Both are server-side so the persona can change without touching the client, and `renderEpisode` is unit-tested from the browser side (`src/companion/renderEpisode.test.ts`) because what the model is _told_ is as much a decision as what it is asked. A different model is `OBSERVER_MODEL` in `.env`; a different voice is `TTS_VOICE`.
- **More of the representation reaching the observer** (attention, a text edit, a new node type) → the gap is upstream of the companion. Add the change kind to `canvasDiff.ts`, the event to `events.ts`, then carry it through `buildEpisodeSummary` and `describeStructural`. Don't special-case it in the companion: an episode should stay a restatement of things a reader could already see in the JSON.

## Known limitations

- **Formatting is lost when a canvas is rebuilt from canonical JSON.** `NodeContent.text` is a plain string, so bold and lists don't survive a JSON → shape rebuild. Text itself round-trips exactly. Pinned by a test.
- **One Canvas is one tldraw page.** The page menu is hidden to keep that true.
- **`shape.meta` has no _schema_, but its values are still validated.** Custom meta validators need `createTLSchema`, which needs the `store` prop, which is mutually exclusive with `persistenceKey` — so nothing checks that `contextualField` looks the way we expect, and the adapter reads meta defensively instead. What _is_ enforced is `T.jsonValue`: the record validator walks meta and rejects the whole write with `Expected json serializable value` if it finds an `undefined` anywhere. Use `null` to mean "absent" in a meta patch, never `undefined`.
- **Meta patches are shallow-merged, key by key.** `editor.updateShapes` merges `meta` onto the existing meta (`applyPartialToRecordWithProps`), so omitting a key keeps its old value rather than removing it. Clearing a field has to be written explicitly — see `contextualFieldPatch`.
- **Visual ids have no row banding.** Reading order compares centre `y` strictly, so notes laid out in a row with tops jittered by a few pixels are numbered by that jitter rather than left to right. Deterministic, but not always what a human reads. A tolerance band would fix it and needs a magic constant, so it is not in the MVP.
- **A grounded export downloads two files from one click**, which Chrome may ask permission for the first time.
- **Arrow geometry doesn't survive a round trip.** `Relation` deliberately carries no anchor, bend or terminal detail, so an imported arrow re-binds centre-to-centre. The _relationship_ round-trips exactly; its draughtsmanship doesn't — the same trade as text formatting.
- **Deleting a Node leaves a dangling arrow.** tldraw drops the binding and keeps the line, which then fails the "both ends bound" guard: the relation vanishes from the JSON while the line stays on the canvas. A delete cascade is the fix if it grates.
- **Import replaces canonical content only.** Nodes and relation arrows are cleared and rebuilt; plain arrows and drawings are left alone, because the document never described them and so can neither restore nor honestly discard them.
- **Relation arrows do appear in the grounded screenshot**, unlike the field overlay. They are canvas content the user drew, not a synthesised annotation — which is what the "no influence lines on the export" rule was about.
- **A badge can still overlap something.** Placing it on the drawn path retired the two failure modes that mattered — a badge stranded in open canvas, and reciprocal arrows sharing one midpoint, since two curves between the same pair now have different midpoints — but a path crossing a Node still puts its badge over that Node, and two arrows crossing each other still put their badges close together. Nudging them apart needs a layout pass, which the MVP doesn't have. `grounding.relations[].badge` at least says exactly where each one went.
- **An arrow the renderer can't measure gets no badge and no `grounding.relations` entry.** It is still in `relations` and still drawn in the picture; only the annotation is missing. That is the deliberate trade for never throwing inside the reactive computed that builds the document — see [Why the badge is measured](#why-the-badge-is-measured-rather-than-derived). In practice it is why a _labelled_ relation arrow gets no badge in the headless test suite, where no `textOptions` are configured; the app itself configures them.
- **`grounding.relations` is keyed by position, not identity** — `R1` is where an arrow sits in reading order for one export, exactly as `N1` is for a Node. Redraw an arrow and the numbering can change; `relationId` inside the entry is the stable handle.
- **`INTENT_WEIGHT = 0.75` is uncalibrated.** It satisfies "intent counts for significantly more than proximity" and nothing finer, because nothing consumes `effectiveStrength` yet — so there is no task to tune it against. It is one named constant in one file, and the strategy name travels with every row, precisely so the number can be revised without archaeology.
- **`effectiveStrength` is not in the grounded screenshot.** The export deliberately draws nothing derived, and a combined value is derived twice over. A reader joins it from the JSON via `grounding.nodes`, the way they already do for influence.
- **The event log is in memory only, and short.** The stream keeps the most recent 200 events and the panel shows 50; a reload starts empty. That is deliberate — events are a record of change, not a fact about the canvas, so persisting them would be the second store the rest of the design avoids — but it does mean the log is a live instrument rather than a session history, and there is no timeline to scrub.
- **Editing a note's text emits no event.** `diffCanvas` compares geometry, contextual fields and relations — not `content.text` — so a text edit bumps `updatedAt` and changes nothing the stream can see. The event vocabulary is deliberately spatial, and a `content_changed` event would be the first one that isn't. Pinned by a test so it stays a decision.
- **A drag fills the log.** `registerSpatialEvents` diffs on every document-scope store change, and a drag is many of them, so crossing a boundary mid-gesture emits a run of `influence_changed` rows rather than one summary per gesture. Coalescing them would need a notion of "gesture" the model doesn't have.
- **An undo appends rather than retracts.** An undo is a document change like any other, so the stream reports the events that _reverse_ it (`node_moved`, then whichever crossing that implies). A subscriber is never told to un-act on an event it already handled. Pinned by a test.
- **Events carry no causality.** `deriveEvents` inherits the diff's refusal to attribute: a `node_moved` and the `influence_changed` rows around it arrive as siblings, never as cause and effect, because with two nodes moving the attribution would be an inference. See [Change detection](#change-detection).
- **The proximity thresholds are uncalibrated**, exactly like `INTENT_WEIGHT`. `STRONG_PROXIMITY = 0.66` and `WEAK_PROXIMITY = 0.33` split a continuous influence into bands so `proximity_changed` has something to report; nothing consumes the bands yet, so there is no task to tune them against. Two named constants in one file.
- **There is one node type.** `NodeType` is `'post_it'` and nothing else, so every idea on this canvas is words. Image, article and agent nodes are what the abstraction was built for — `NodeContent` keeps `text` generic at the Node level precisely so a source URL can sit beside it — and none of them exist. See [Where to add things](#where-to-add-things).
- **Attention is not part of the representation.** Selection drives the field highlight and the [influence badges](#influence-scores), and stops there: it is in no `CanvasDocument`, emits no event, and never reaches the observer. So the companion can see that you moved something and not what you are looking at, which is a large share of what a person is actually doing.
- **The companion cannot write back.** It observes the representation and speaks about it; adding a node, drawing a relation or proposing a grouping is not wired, so the loop closes through the user rather than through the canvas.
- **A text edit reaches neither the stream nor the observer** — the same limitation as the event vocabulary above, but worth stating twice, because it means the companion is blind to the one change that alters what an idea _means_.
- **The companion needs two API keys and is otherwise silent.** With no `.env` the routes fail safe and return `{ speak: false }`, which is indistinguishable at the UI from a model that had nothing to say. Everything else in the app is unaffected.
- **The transcript is in memory and capped** at `TRANSCRIPT_LIMIT` (50); a reload starts empty, for the same reason the event log does. Anti-repetition sees only the last `DEFAULT_HISTORY_SIZE` (3) remarks, so the companion can repeat itself across a long session.
- **`TRIVIAL_INFLUENCE_EPSILON` is uncalibrated**, like `INTENT_WEIGHT` and the proximity bands: 0.05 is a guess at what counts as a nudge, set to feel right in use rather than measured against a task. `EPISODE_IDLE_MS` used to be the same kind of guess and is now only the [resting value](#a-queue-not-a-thought) of one that corrects itself — but the four constants governing that correction (step, margin, ceiling, and the halving on success) are themselves uncalibrated, and only the ceiling has an argument behind it.
- **The pause adapts to one signal, not to a person.** It resets to `EPISODE_IDLE_MS` on every mount, so nothing is learned across sessions, and it is driven by a single conjunction — a remark dropped as no longer true, by a user who came straight back — rather than by the distribution of the user's actual pauses. A user whose rhythm is consistently slower re-earns the same penalty at the start of every session. The raise also lands on the _next_ gesture rather than the one that earned it, since the drop happens well after the recorder has armed its timer.
- **A queue is only as deep as the model is talkative.** Silence is the normal verdict, so most thoughts leave the queue after the observe call alone and the backlog is usually one or two. That is the design working, but it means the visible queue is rarely as legible as the mechanism behind it.
- **`isStillTrue` reads the episode, not the remark.** Nothing records what a remark asserted, so the check is a proxy: it cannot contradict a remark about the board as a whole, or one whose phrasing wandered from the change that prompted it. The age cap is what covers those, which is why it is the primary rule and this is the secondary one.
- **An open arc keeps accumulating until it is worth a remark.** Carried events are cleared only when an episode is actually _sent_, so an arc that keeps overflowing a full queue, or one whose merged episode keeps netting out below the significance gate, grows until something meaningful happens — bounded only by the `EPISODE_BUFFER_LIMIT` slice, which costs the arc its earliest `before` when it bites.
- **A drag that never pauses never becomes an episode.** The recorder finalizes on idle, so continuous manipulation defers the observation indefinitely — `EPISODE_BUFFER_LIMIT` (2000 events) is a backstop against unbounded growth, and hitting it costs the episode its earliest `before`.

## Testing

`npm test` runs three layers, because the first one alone turned out not to be enough — two bugs shipped that were invisible to pure tests (a meta write the record validator rejected, and a control whose commit was destroyed by the selection change that triggered it).

| Layer              | Files                                                                                                                                                                                                                                                                   | Environment                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Pure               | `domain/{canvas,spatialInfluence,effectiveStrength,canvasDiff,events,eventStream,episode}.test.ts`, `companion/{renderEpisode,reveal,thoughtQueue}.test.ts`, `adapter/{adapter,relations}.test.ts`, `grounding/{visualId,projection,grounding,annotationLayer}.test.ts` | `node` — no DOM, no editor |
| Real editor        | `adapter/{editor,relationEditor,spatialEvents,episodeValidity}.test.ts`, `dev/seedScenario.test.ts`, `grounding/groundedExport.test.ts`, `companion/{companion,voiceClient}.test.ts`                                                                                    | `jsdom`                    |
| Rendered component | `ui/*.test.tsx`                                                                                                                                                                                                                                                         | `jsdom`                    |

The companion needs no network, no clock and no audio device to be tested: `createCompanion` takes an `ObserverClient`, a `VoiceClient` and a `Schedule`, so every branch of the loop — silence, voice off, observation off, interruption, anti-repetition, the text/voice handover — is driven through fakes. `renderEpisode` is tested from the client side even though it lives in `server/` (imported by relative path, since Vite's `@` alias doesn't cover it), because what the model is _told_ is as much a decision as what it is asked: a payload rendered as opaque shape ids still produces a fluent remark, just a meaningless one. The two routes themselves have no tests — what is left of them after the prompt is the SDK.

The default environment is `node`; the DOM suites opt in with a `@vitest-environment jsdom` docblock. That keeps the pure layer honest: `src/domain`, `src/canvas/adapter` and `postItShape.ts` import tldraw for _types only_, and adding a runtime tldraw import to any of them will break it.

Rasterising is the one thing no layer covers: `toImage` and `createImageBitmap` need a real browser. That is why the grounding module is split the way it is — every decision that could put a box in the wrong place lives in a pure function, and `groundedExport.ts` is left holding only the browser calls. `annotationLayer.ts` is typed against a structural subset of `CanvasRenderingContext2D` so a recorder can stand in for one, rather than adding a native canvas build to check that four `lineTo` calls happened.

The editor layer constructs a real `Editor` over a `createTLStore` with no React at all, which is what makes "does this actually reach the canonical Canvas" testable. Anything that writes through the editor belongs in `adapter/` rather than in a component, so it can be tested there — `contextualField.ts` exists for exactly that reason.

## Persistence

`<Tldraw persistenceKey="llm-spatial-context-nodes" />` stores the document in the browser's IndexedDB. Work survives a refresh and syncs live between tabs on the same origin. To start from a blank canvas each reload, remove the `persistenceKey` prop in `src/canvas/Canvas.tsx`.

Changing a registered shape type without a migration will make stored records fail to load; bump the key when that happens.

## A note on the tldraw license

The tldraw SDK runs without a license key in development (localhost). A production deployment — HTTPS on a non-localhost domain with `NODE_ENV=production` — requires a `licenseKey` prop, and non-commercial keys keep the "made with tldraw" watermark visible. See [tldraw.dev/pricing](https://tldraw.dev/pricing).

## Docs

`tldraw` ships its own documentation inside the installed package, matching the exact installed version:

- `node_modules/tldraw/DOCS.md` — full SDK docs
- `node_modules/tldraw/RELEASE_NOTES.md` — versioned release notes and migration guides

These are the most reliable reference, since tldraw v5 changed a number of APIs from v2–v4.
