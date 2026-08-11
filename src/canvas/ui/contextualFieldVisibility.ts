/**
 * Whether the contextual-field overlay is showing.
 *
 * A module-scope atom rather than React state, because the switch and the overlay
 * are siblings with no common parent to hold it: `components` in
 * `src/canvas/config.tsx` is declared at module scope on purpose, since tldraw
 * compares that object by identity and rebuilding it per render would remount the
 * editor. An atom is reactive across that gap without a provider.
 *
 * Deliberately **not** persisted and **not** canonical. It is a preference about
 * looking, not a fact about the canvas, so it has no place in `shape.meta` or in
 * the canonical JSON.
 */
import { atom } from 'tldraw'

export const showContextualFields = atom('show contextual fields', true)
