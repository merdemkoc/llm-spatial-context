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

tldraw's store is the single runtime store; the canonical Canvas is a derived view over it (`getCanvasDocument`). There is no second store to fall out of step, so undo/redo, IndexedDB persistence and cross-tab sync all keep working untouched. The state tldraw can't express — `createdAt`, `updatedAt`, `createdBy` — lives in `shape.meta`, which tldraw persists and syncs but never reads.

## Layout

```
src/
  main.tsx                     React entry point
  App.tsx                      Thin shell, renders <Canvas />
  index.css                    Global styles + tldraw.css import
  domain/                      The canonical model — no tldraw imports, ever
    node.ts                    CanvasNode, spatial/visual/metadata, createPostItNode
    canvas.ts                  CanvasDocument, Relation placeholder
  canvas/
    Canvas.tsx                 The <Tldraw /> wrapper — persistence, onMount hook
    config.tsx                 Module-scope shape utils, tools, UI overrides and toolbar
    adapter/                   The only code that knows both sides
      adapter.ts               shapeToNode / nodeToShape — the round-trip pair
      ids.ts                   NodeId ⇄ TLShapeId
      richText.ts              plain text ⇄ rich text, kept pure
      canvasView.ts            getCanvasDocument(editor), useCanvasDocument()
      metadata.ts              createdAt / updatedAt side effects
    shapes/                    The tldraw projection of a post_it
      postItShape.ts           Shape type + guard (type-only tldraw imports)
      postItStyles.ts          Raw-hex StyleProps for fill / stroke / text
      PostItShapeUtil.tsx      Rendering, geometry, resize, text editing
      PostItTool.ts            Creates the Node first, then projects it
    ui/
      InspectorPanel.tsx       Live canonical JSON, with export and import
      PostItStylePanel.tsx     Colour controls
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
- **`shape.meta` is unvalidated.** Meta validators need `createTLSchema`, which needs the `store` prop, which is mutually exclusive with `persistenceKey`. The adapter reads meta defensively instead.

## Testing

`npm test` runs the round-trip invariant over the adapter as pure functions — no DOM, no editor. That works because `src/domain`, `src/canvas/adapter` and `postItShape.ts` import tldraw for _types only_; adding a runtime tldraw import to any of them will break it.

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
