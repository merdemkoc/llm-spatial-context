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
| `npm run lint`         | ESLint over the repo                        |
| `npm run lint:fix`     | ESLint with autofix                         |
| `npm run format`       | Prettier write                              |
| `npm run format:check` | Prettier check (no writes)                  |

## Layout

```
src/
  main.tsx                     React entry point
  App.tsx                      Thin shell, renders <Canvas />
  index.css                    Global styles + tldraw.css import
  canvas/
    Canvas.tsx                 The <Tldraw /> wrapper — persistence, onMount hook
    config.tsx                 Module-scope shape utils, tools, UI overrides and toolbar
  shapes/
    NoteCardShapeUtil.tsx      Example custom shape (safe to delete)
  tools/
    NoteCardTool.ts            Example custom tool (safe to delete)
```

Imports resolve `@/` to `src/`, e.g. `import { Canvas } from '@/canvas/Canvas'`.

## Where to add things

- **Prototype logic that needs the editor** → the `onMount(editor)` callback in `src/canvas/Canvas.tsx`. It receives the `Editor` instance and is the intended seam for new behaviour.
- **A new custom shape** → copy `src/shapes/NoteCardShapeUtil.tsx`, then register it in `customShapeUtils` in `src/canvas/config.tsx`.
- **A new custom tool** → copy `src/tools/NoteCardTool.ts`, register it in `customTools`, add it to `uiOverrides` for its label and shortcut, and add a `TldrawUiMenuItem` to the `Toolbar` override so it actually appears (all three in `src/canvas/config.tsx`).

The `NoteCard` shape and tool are reference implementations of the tldraw v5 APIs. Delete them once you have your own — nothing else depends on them.

## Persistence

`<Tldraw persistenceKey="llm-spatial-context" />` stores the document in the browser's IndexedDB. Work survives a refresh and syncs live between tabs on the same origin. To start from a blank canvas each reload, remove the `persistenceKey` prop in `src/canvas/Canvas.tsx`.

## A note on the tldraw license

The tldraw SDK runs without a license key in development (localhost). A production deployment — HTTPS on a non-localhost domain with `NODE_ENV=production` — requires a `licenseKey` prop, and non-commercial keys keep the "made with tldraw" watermark visible. See [tldraw.dev/pricing](https://tldraw.dev/pricing).

## Docs

`tldraw` ships its own documentation inside the installed package, matching the exact installed version:

- `node_modules/tldraw/DOCS.md` — full SDK docs
- `node_modules/tldraw/RELEASE_NOTES.md` — versioned release notes and migration guides

These are the most reliable reference, since tldraw v5 changed a number of APIs from v2–v4.
