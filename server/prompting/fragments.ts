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
