/**
 * Prompt paragraphs more than one agent needs, named once.
 *
 * These are composed into each system prompt rather than applied to all of them: the point
 * is not that every agent gets every rule, it is that each agent's prompt reads as a visible
 * list of the rules it opts into. The suggester went a long time reading proximity data
 * without ever being told what proximity was, because there was no place where its missing
 * primer would have looked missing.
 */

/**
 * What the canvas is and what its two signals mean.
 *
 * Every agent is shown proximity or gravity or both, so every agent needs this. It was
 * previously written twice in different words (the observer's and the reflection's) and
 * omitted entirely from the suggester.
 */
export const CANVAS_PRIMER = `The canvas works like this: each node is an idea, written on a note. Moving two ideas closer raises a proximity signal called "influence" (0 = far apart or out of range, 1 = right on top of each other). Drawing an arrow — a "relation" — makes a connection explicit, with its own strength called "gravity" that is independent of distance. Proximity and explicit relations are different statements, and a disagreement between them is information, not a mistake.`

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
- The change fits the understanding — it is already accounted for. Usually stay silent.
- The change extends it — it names something the understanding does not yet hold. Worth a word if the addition is real.
- The change contradicts it — the board is no longer what you understood it to be. This is the most worth saying, and naming what changed about the whole beats describing the move.

A standing understanding is never itself a reason to speak. Do not summarize it, list its themes, or remark on parts of the board this change did not touch.`
