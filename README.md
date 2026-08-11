# llm-spatial-context

A prototyping boilerplate for building on the [tldraw](https://tldraw.dev) infinite canvas, with Vite, React 19 and TypeScript.

## Getting started

Requires Node `>=22.12.0` (a tldraw SDK requirement).

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Scripts

| Script                 | Does                                        |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Vite dev server with HMR                    |
| `npm run build`        | Typecheck, then production build to `dist/` |
| `npm run preview`      | Serve the production build locally          |
| `npm run typecheck`    | `tsc --noEmit`                              |
| `npm test`             | Vitest, single run                          |
| `npm run test:watch`   | Vitest in watch mode                        |
| `npm run lint`         | ESLint over the repo                        |
| `npm run lint:fix`     | ESLint with autofix                         |
| `npm run format`       | Prettier write                              |
| `npm run format:check` | Prettier check (no writes)                  |

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

- The radius is optional and **never defaulted**. A Node with no field exerts no influence, which is a different claim from a Node with a small one.
- The centre is rotation-aware. `SpatialProperties.rotation` is applied about the top-left corner, so `x + width / 2` is only the centre of an unrotated box.

#### Seeing it

The field was the one piece of spatial state with no visual form — set as a number, read back as numbers, so "does this note reach that one?" meant comparing a distance column against a radius by hand. The **Contextual fields** switch (top right, beside _Canonical JSON_) draws it: a dashed circle per Node that has a radius, every one at once, so overlapping reach is something you see rather than compute.

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
| Explicit semantic relations | `relations`                                  | What did the user actually connect, and call it?               |
| Visual grounding            | `grounding`                                  | Which region of a screenshot is this node?                     |

The first three speak in **canvas coordinates**; `grounding` speaks in **screenshot pixels**. That is why it is its own layer rather than extra fields on `spatial`.

```json
{
	"nodes": {
		"node-a": { "spatial": { "x": 300, "y": 200, "…": "…" }, "contextualField": { "radius": 500 } }
	},
	"relations": { "relation-1": { "from": "node-a", "to": "node-b", "type": "causes" } },
	"spatialContext": {
		"influences": [{ "source": "node-a", "target": "node-b", "distance": 326, "influence": 0.349 }]
	},
	"grounding": {
		"image": { "width": 1998, "height": 1140 },
		"nodes": { "N1": { "nodeId": "node-a", "bbox": [80, 80, 560, 400] } }
	}
}
```

**Proximity never becomes a relation.** Nothing infers `related_to`, or any other type, from two Nodes being close. `relations` is what the user said; `spatialContext` is what the layout implies and nobody named. The reverse holds too: a relation between two distant Nodes creates no influence.

### Relations

The **Relation** tool (`r`) draws an arrow from one post-it to another, and that act is the statement: _these two are related_. Double-click the arrow and type `causes`, and the label becomes the relation's `type`.

```json
"relations": {
	"sjWvRRvYRGPbJy9i9h44-": { "id": "sjWvRRvYRGPbJy9i9h44-", "from": "cdhJU…", "to": "QhEky…", "type": "causes" }
}
```

`type` is **optional and never defaulted**. An unlabelled arrow means "connected, and the user didn't say why", which is a different claim from `related_to` — inventing that word is precisely the inference this model refuses to make, so an empty label produces no `type` key at all. Same rule as `contextualField`.

**The tool is ours; the shape is tldraw's.** `ArrowShapeTool` is a five-line `StateNode`, so `RelationTool` subclasses it and inherits the entire interaction — drag-to-connect, binding, precise anchors, elbow routing, label editing, re-routing when a Node moves. A bespoke `relation` shape would have meant reimplementing `ArrowShapeUtil` to arrive back at an arrow. `ShapeUtil.canBind()` already defaults to `true`, so post-its were bindable from the start; only the projection was missing.

What separates a relation from a decorative arrow is `meta.relation`, stamped by `getInitialMetaForShape` while the Relation tool is the current one — not the shape type (both are `arrow`) and not the styling, so restyling an arrow never changes what it means. **A plain arrow between two post-its stays decoration.**

Relations are **derived on read**, like everything else: `getCanvasRelations` walks the page's relation arrows and reads their bindings, so there is no second store, and moving a Node, redrawing an arrow or undoing all produce a correct document with nothing to invalidate. Four guards decide what counts, and each is a claim about what a relation is:

| Rejected                   | Because                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| One end loose              | A half-drawn gesture doesn't relate two things, and guessing the other end would invent the claim |
| Bound to a non-Node        | A draw or geo shape isn't a canonical entity                                                      |
| Both ends on the same Node | Follows `calculateSpatialInfluences`, which omits self-pairs                                      |
| Untagged arrow             | Decoration is not an assertion                                                                    |

Nothing in the projection looks at geometry, and nothing in `spatialInfluence.ts` looks at arrows. That is what keeps the two layers answering different questions.

`spatialContext` is assembled in `getCanvasDocument`, the one place a document is built, which is why it needs no invalidation logic and no manual trigger — a move, a resize, a radius change, an addition or a deletion all produce a fresh document. It is **output, not input**: importing a document ignores whatever `spatialContext` it carried and derives a new one from the Nodes.

Every directed pair is emitted, including out-of-range ones at `influence: 0`, so "these are too far apart" stays distinguishable from "this pair wasn't considered". That is `N² − N` entries. Distance is rounded to whole units and influence to three decimals in the document; `calculateSpatialInfluences` stays exact for anything doing further arithmetic.

### Grounded screenshot

The other three layers speak in canvas coordinates — they say where a Node is and what reaches it. What none of them can say is which _pixels_ it occupies. A model handed a screenshot and the JSON has to work that out from world coordinates, and inferring it is exactly the kind of guess the rest of this design removes.

`grounding` closes that gap, and the **Grounded screenshot** button in the Inspector panel exports the image it describes: a PNG of the canvas with every Node outlined and labelled `N1`, `N2`, `N3`.

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

**`spatial` and `grounding.bbox` are different coordinate systems, and the separation is the point.** `spatial` is the canvas — world units, an origin the camera can't move, unchanged by any export. `bbox` is one screenshot — pixels from that image's top-left, meaningless without the `image` it came with. A Node 900 world units down the canvas is 1880px down a 2×-scale PNG; conflating the two is the mistake this layer makes impossible.

`bbox` is `[x1, y1, x2, y2]` — opposite corners, not `[x, y, width, height]` — rounded to whole pixels, since a screenshot has no sub-pixel position to point at.

The layer is an _index, not an interpretation_. It draws boxes and labels and nothing else — no relation lines, no influence rings, no distance markers. Those claims already exist in `relations` and `spatialContext`, and drawing them would mix a reading of the canvas into what is meant to be a lookup table between pixels and ids. Nothing is drawn filled either, so the canvas underneath survives intact.

Six things about it are worth knowing:

- **`grounding` is derived, never stored** — assembled in `getCanvasDocument` beside `spatialContext`, recomputed on every read, and **output, not input**: importing a document ignores whatever `grounding` it carried. It describes the screenshot the canvas _would_ export right now, which is knowable rather than guessed: the bounds come from the Nodes and the pixel ratio is fixed at 2, so `image` is `floor(bounds × 2)`. The export then measures the bitmap it actually produced and substitutes that, so a saved PNG + JSON pair always describes itself. A test pins the two together — the prediction and the measurement come out equal.
- **`N1` is a position, not an identity.** Moving a Node can renumber every label; the node id remains the only stable handle. A label exists so a short token can be pointed at in an image.
- **A rotated Node's `bbox` is looser than its outline.** Four numbers can't express a rotation, so the bbox is the smallest axis-aligned box containing the Node, while the outline drawn on the image follows the rotation. A test pins the bbox to the drawn quad's corners so the two can never disagree about which Node they describe.
- **The image covers every Node, not the viewport.** Bounds come from the Nodes themselves, expanded by `GROUNDING_PADDING`, so a Node parked far off screen is still in the picture. Grounding something that isn't visible would be worse than not grounding it.
- **The scale is measured, never assumed.** `toImage` reports the _logical_ size it rendered at, while `scale`, `pixelRatio`, flooring and the browser's maximum canvas size all sit between that and the actual blob. `imageScale` derives pixels-per-world-unit from the decoded bitmap, and throws if the height doesn't follow from the width — a box in the wrong place is worse than no box. Note it checks the _height in pixels_ rather than comparing the two axes' implied scales: the axes are floored independently, so those scales never quite agree, and the disagreement grows with the aspect ratio. Judging it against a fixed pixel budget rejects a wide canvas for being wide.
- **Only the export validates.** `buildGrounding` deliberately checks nothing, because `getCanvasDocument` runs inside a reactive computed — anything thrown while deriving a layer takes the editor down rather than showing a bad number. This follows `calculateSpatialInfluence`, which returns `0` for every degenerate input for the same reason: an unvalidated canvas is a normal state to be in, not an error to interrupt a render for.

## Layout

```
src/
  main.tsx                     React entry point
  App.tsx                      Thin shell, renders <Canvas />
  index.css                    Global styles + tldraw.css import
  domain/                      The canonical model — no tldraw imports, ever
    node.ts                    CanvasNode, spatial/visual/metadata, createPostItNode
    canvas.ts                  CanvasDocument — the four layers
    grounding.ts               Grounding types — screenshot pixels, not canvas units
    spatialInfluence.ts        Node centre, distance, influence, buildSpatialContext
  canvas/
    Canvas.tsx                 The <Tldraw /> wrapper — persistence, onMount hook
    config.tsx                 Module-scope shape utils, tools, UI overrides and toolbar
    adapter/                   The only code that knows both sides
      adapter.ts               shapeToNode / nodeToShape — the round-trip pair
      ids.ts                   NodeId ⇄ TLShapeId
      richText.ts              plain text ⇄ rich text, kept pure
      relations.ts             arrow ⇄ Relation, and rebuilding arrows on import
      canvasView.ts            getCanvasDocument(editor), useCanvasDocument()
      metadata.ts              createdAt / updatedAt side effects
      contextualField.ts       setContextualFieldRadius(editor, ids, radius)
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
      annotationLayer.ts       Draws the outlines and labels onto a 2D context
      groundedExport.ts        toImage, composite, save the PNG + JSON pair
    ui/
      InspectorPanel.tsx       Live canonical JSON, influence table, grounded export
      PostItStylePanel.tsx     Colour controls, and hosts the field control
      ContextualFieldControl.tsx  Radius input for the selection
      ContextualFieldOverlay.tsx  Dashed reach circles, drawn behind the shapes
      InfluenceBadges.tsx         Both directions' scores, on the affected notes
      ContextualFieldToggle.tsx   The show/hide switch
      contextualFieldVisibility.ts  Module atom shared by the two above
```

Imports resolve `@/` to `src/`, e.g. `import { Canvas } from '@/canvas/Canvas'`.

**`src/domain` must never import tldraw.** That's the whole point of the split, so ESLint enforces it rather than leaving it to code review.

## Where to add things

- **A new node type** → add it to `NodeType` in `src/domain/node.ts`, give it a shape util and tool under `src/canvas/shapes/`, and extend the adapter. The `Canvas` model itself shouldn't need to change.
- **Prototype logic that needs the editor** → the `onMount(editor)` callback in `src/canvas/Canvas.tsx`.
- **A new custom shape** → copy `src/canvas/shapes/PostItShapeUtil.tsx`, then register it in `customShapeUtils` in `src/canvas/config.tsx`.
- **A new custom tool** → copy `src/canvas/shapes/PostItTool.ts`, register it in `customTools`, add it to `uiOverrides` for its label and shortcut, and add a `TldrawUiMenuItem` to the `Toolbar` override so it actually appears (all three in `src/canvas/config.tsx`).

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
- **Relation arrows do appear in the grounded screenshot**, unlike the field overlay. They are canvas content the user drew, not a synthesised annotation — which is what the "no influence lines on the export" rule was about. `grounding` still indexes Nodes only.

## Testing

`npm test` runs three layers, because the first one alone turned out not to be enough — two bugs shipped that were invisible to pure tests (a meta write the record validator rejected, and a control whose commit was destroyed by the selection change that triggered it).

| Layer              | Files                                                                                                                          | Environment                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Pure               | `domain/*.test.ts`, `adapter/{adapter,relations}.test.ts`, `grounding/{visualId,projection,grounding,annotationLayer}.test.ts` | `node` — no DOM, no editor |
| Real editor        | `adapter/{editor,relationEditor}.test.ts`, `grounding/groundedExport.test.ts`                                                  | `jsdom`                    |
| Rendered component | `ui/*.test.tsx`                                                                                                                | `jsdom`                    |

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
