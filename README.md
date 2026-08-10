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

Influence is **derived, never stored**. It is a function of two Nodes' geometry plus the source's radius, so moving a Node changes its context with no state to invalidate — nothing writes an `influence` field back into the canonical JSON. It is also directional: two Nodes with different radii influence each other by different amounts, without any semantic relation being involved.

Two details worth knowing:

- The radius is optional and **never defaulted**. A Node with no field exerts no influence, which is a different claim from a Node with a small one.
- The centre is rotation-aware. `SpatialProperties.rotation` is applied about the top-left corner, so `x + width / 2` is only the centre of an unrotated box.

## Layout

```
src/
  main.tsx                     React entry point
  App.tsx                      Thin shell, renders <Canvas />
  index.css                    Global styles + tldraw.css import
  domain/                      The canonical model — no tldraw imports, ever
    node.ts                    CanvasNode, spatial/visual/metadata, createPostItNode
    canvas.ts                  CanvasDocument, Relation placeholder
    spatialInfluence.ts        Node centre, distance, derived spatial influence
  canvas/
    Canvas.tsx                 The <Tldraw /> wrapper — persistence, onMount hook
    config.tsx                 Module-scope shape utils, tools, UI overrides and toolbar
    adapter/                   The only code that knows both sides
      adapter.ts               shapeToNode / nodeToShape — the round-trip pair
      ids.ts                   NodeId ⇄ TLShapeId
      richText.ts              plain text ⇄ rich text, kept pure
      canvasView.ts            getCanvasDocument(editor), useCanvasDocument()
      metadata.ts              createdAt / updatedAt side effects
      contextualField.ts       setContextualFieldRadius(editor, ids, radius)
    shapes/                    The tldraw projection of a post_it
      postItShape.ts           Shape type + guard (type-only tldraw imports)
      postItStyles.ts          Raw-hex StyleProps for fill / stroke / text
      PostItShapeUtil.tsx      Rendering, geometry, resize, text editing
      PostItTool.ts            Creates the Node first, then projects it
    ui/
      InspectorPanel.tsx       Live canonical JSON + derived influence table
      PostItStylePanel.tsx     Colour controls, and hosts the field control
      ContextualFieldControl.tsx  Radius input for the selection
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

## Testing

`npm test` runs three layers, because the first one alone turned out not to be enough — two bugs shipped that were invisible to pure tests (a meta write the record validator rejected, and a control whose commit was destroyed by the selection change that triggered it).

| Layer              | Files                                         | Environment                |
| ------------------ | --------------------------------------------- | -------------------------- |
| Pure               | `domain/*.test.ts`, `adapter/adapter.test.ts` | `node` — no DOM, no editor |
| Real editor        | `adapter/editor.test.ts`                      | `jsdom`                    |
| Rendered component | `ui/*.test.tsx`                               | `jsdom`                    |

The default environment is `node`; the two DOM suites opt in with a `@vitest-environment jsdom` docblock. That keeps the pure layer honest: `src/domain`, `src/canvas/adapter` and `postItShape.ts` import tldraw for _types only_, and adding a runtime tldraw import to any of them will break it.

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
