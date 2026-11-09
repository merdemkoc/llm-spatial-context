# llm-spatial-context

An experiment in giving an AI the representation a person is thinking in, instead of a prompt.

![The canvas with contextual-field overlays, influence badges, and the live canonical-JSON inspector](docs/images/inspector-hero.png)

## The idea

When people work through a hard problem on paper or on a canvas, they don't only write ideas down. They move one closer to another, pull two apart, group a few, draw a line between them. Often no word on the board changes. What changes is where things sit and what they sit beside. I think that arrangement is part of the thinking, not just a record of it.

So the question this prototype tests is: what happens if an AI can observe that representation directly, and share it?

There are no prompts here. You arrange post-its on a [tldraw](https://tldraw.dev) canvas. A machine-readable description of the board updates as you work, and an AI companion watches it change. Now and then it says something about what you did, or proposes a grouping, a note or an arrow, which you can accept or ignore.

## The assumptions behind it

None of these is proven. The prototype exists to make them testable.

### Arrangement carries meaning

Putting two notes side by side, or pulling one away from a cluster, changes what the board says even when the text stays the same. So the model is given positions and distances, not only content.

### Context is a field, not a point

What an idea means depends on what surrounds it. Each note can have a reach, and its influence on a neighbour fades with distance. Influence is directional: a note with a wide reach affects a nearby note more than that note affects it back.

### What the user says and what the layout suggests are different claims

Two notes can sit next to each other with no connection in the user's head, and two notes far apart can be the most connected pair on the board. Drawing an arrow is an explicit statement. Closeness is only a hint. Merging the two into one "related" score would erase the very signal worth having, so they stay separate: proximity never becomes a relation, and dragging notes apart never removes one.

![Note B dragged far out of note A's reach: its influence has fallen to 0, while the relation the user drew from A to B still holds at full strength](docs/images/event-stream.png)

### Nothing gets invented

An arrow with no label means "connected, and the user didn't say why", not `related_to`. A note with no reach reaches nothing, which is a different claim from a small reach. The representation holds only what the user did and what follows directly from geometry.

### A model shouldn't have to guess what it can be told

Given a screenshot and a description of the board, a model would have to work out which pixels belong to which note. Instead, every note is labelled in the exported image, and its pixel box is listed next to its id.

![The exported PNG: each post-it outlined in pink and labelled N1, N2, N3, the relation arrow badged with its strength](docs/images/grounded-screenshot.png)

### The change matters more than the snapshot

Thinking happens over time. You move an idea, bring another next to it, connect them, change your mind. For an AI the useful signal may be that process rather than the final board, so every change is observable, and changes are grouped into gestures, one per pause.

### A good companion is mostly quiet

The AI isn't there to comment on everything. After each pause it decides whether anything is worth saying, and usually the answer is no.

![The companion's latest remark at the top of the canvas, with the transcript open beneath it](docs/images/companion-remark.png)

Both remarks above are what the model said about the board beneath them. The newer one is about an arrow drawn between two distant notes: proximity says they are unrelated, and the user has just said otherwise.

### The human holds the pen

The AI can propose which notes belong together, or new notes and arrows to add, but each proposal stays a ghost until the person accepts it.

![A reflection pending on the canvas: proposed notes as dashed ghost cards, and a panel listing them with accept and dismiss controls](docs/images/agent-write-back.png)

## What an early test suggested

I gave Gemini a grounded screenshot of four notes along with the board's JSON. The arrows said `N4 → N1` and `N3 → N2`, while the text of the notes implied a chain, `N4 → N3 → N1 → N2`. The model reported both structures instead of averaging them into one graph, which is exactly what keeping the signals apart is for. It was hand-run and nothing from it is checked in, so read it as a reason to keep going, not as a result.

## What's still open

- Attention. Selecting a note changes what you see, but the AI never learns what you are looking at. This is the gap I find most interesting.
- Images. Every idea on the board is words. The model was built to take image nodes, but none exist yet.
- Changes in meaning. Editing a note's text fires no event. The AI reads the new text the next time it is asked, but a rewrite never prompts it.
- Initiative. The AI proposes edits only when asked, or, for groupings, after a change it chose not to remark on. It never decides on its own that an edit beats a remark.

The full argument, with diagrams, is in [`docs/why.md`](./docs/why.md).

## Try it

Requires Node `>=22.12.0`.

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY and OPENAI_API_KEY
npm run dev
```

Open http://localhost:5173. The keys are only for the companion, Anthropic for its reasoning and OpenAI for its voice. Without them it stays silent and everything else works. In development, run `window.seedDemoScene()` in the browser console for a small scene to drag around.

![The toolbar: pointer, hand, Post-it and Relation, then the companion's two actions](docs/images/toolbar.png)

**Post-it** (`p`) adds a note. **Relation** (`r`) draws an arrow; double-click it to name it. **✦ Suggest a grouping** and **✦ Reflect on board** ask the AI for proposals. **⋯** at the top right switches the reach circles, the AI, its voice and camera-follow on or off, and **`</>`** shows the board's JSON.

## Technical notes

Built on tldraw, Vite, React 19 and TypeScript, with a five-route Hono server that keeps the API keys out of the browser.

- `src/domain` is the canonical model of the board and never imports tldraw. `src/canvas/adapter` is the only code that sees both sides.
- tldraw's store is the only store. The JSON document is derived from it on every read, in four layers: where each note is and how far it reaches, the influence between notes, the relations the user drew, and the screenshot grounding.
- `diffCanvas` compares two documents, `deriveEvents` turns the difference into events, and `src/companion/` groups them into episodes and asks the model about the ones that pass a cheap local check.
- `npm test` runs the test suite. `npm run eval` runs the companion against fixtures on the live API, and costs money.

[`CODEMAP.md`](./CODEMAP.md) covers the rest: every file, the invariants, where to add things, and the known limitations. tldraw needs a license key outside localhost; see [tldraw.dev/pricing](https://tldraw.dev/pricing).
