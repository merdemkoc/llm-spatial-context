/**
 * The one place our panels' chrome is defined.
 *
 * Every value here resolves to a tldraw CSS custom property, which is what makes our
 * panels follow the editor's theme rather than merely matching it in light mode. Before
 * this module, backgrounds read `var(--tl-color-panel)` while every border, shadow and
 * text colour was hard-coded — so dark mode rendered black text on a dark panel behind
 * invisible borders. Reaching for a literal colour here is almost always a mistake; the
 * one deliberate exception is the field ink at the bottom.
 *
 * These are plain style objects rather than a CSS file because the panels themselves are
 * styled inline, and one import is easier to keep honest than a second styling mechanism.
 */
import type { CSSProperties } from 'react'

/**
 * One font declaration, one line-height. The panels are readouts of numbers that have to
 * line up in columns, so the whole custom UI is monospace; tldraw's own chrome supplies
 * the sans face around it.
 */
export const MONO_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const MONO = `12px/1.4 ${MONO_FAMILY}`

/**
 * A surface floating over the canvas: the Inspector, the companion's chip, the button
 * rail. Matches `.tlui-style-panel__wrapper` — same radius, same shadow — so ours and
 * tldraw's panels read as one family.
 */
export const panelChrome: CSSProperties = {
	background: 'var(--tl-color-panel)',
	color: 'var(--tl-color-text)',
	border: '1px solid var(--tl-color-divider)',
	borderRadius: 'var(--tl-radius-3)',
	boxShadow: 'var(--tl-shadow-2)',
}

/**
 * A scrollable block of data — JSON, a table, a log, a transcript. Inset rather than
 * raised: it sits *inside* a panel, so it takes the muted fill instead of a second
 * shadow. Callers add their own `maxHeight`, which is the only thing that differs
 * between the five places this is used.
 */
export const readoutBox: CSSProperties = {
	margin: 0,
	padding: 'var(--tl-space-3)',
	overflow: 'auto',
	borderRadius: 'var(--tl-radius-1)',
	border: '1px solid var(--tl-color-muted-1)',
	background: 'var(--tl-color-muted-2)',
	font: 'inherit',
}

/** Secondary text: section captions, units, hints. A real token, not an opacity guess. */
export const caption: CSSProperties = {
	fontSize: 11,
	color: 'var(--tl-color-text-3)',
}

/**
 * A compact button inside a panel — a section's disclosure row, a Clear.
 *
 * Deliberately not tldraw's `TldrawUiButton`, which is 40px tall: five of those stacked in
 * a 380px column would push the data off the screen. Actions that *do* something use the
 * real thing; these quieter rows only open and close what is already there.
 */
export const panelButton: CSSProperties = {
	padding: '4px var(--tl-space-3)',
	borderRadius: 'var(--tl-radius-1)',
	border: '1px solid var(--tl-color-divider)',
	background: 'var(--tl-color-panel)',
	color: 'var(--tl-color-text)',
	cursor: 'pointer',
	font: 'inherit',
}

/** A checkbox and its label, on one line. Used by every switch in the view-settings popover. */
export const switchRow: CSSProperties = {
	display: 'flex',
	gap: 'var(--tl-space-3)',
	alignItems: 'center',
	cursor: 'pointer',
}

export const checkbox: CSSProperties = { margin: 0, cursor: 'pointer' }

/** A number box in the style panel. One per control — see the note in `ContextualFieldControl`. */
export const numberInput: CSSProperties = {
	minWidth: 0,
	padding: '2px var(--tl-space-2)',
	borderRadius: 'var(--tl-radius-1)',
	border: '1px solid var(--tl-color-divider)',
	background: 'var(--tl-color-panel)',
	color: 'var(--tl-color-text)',
	font: 'inherit',
}

/**
 * The contextual field's own colour, in the one notation the whole app shares.
 *
 * Deliberately neither tldraw's selection blue nor the grounding layer's hot pink: a
 * field circle, a selected shape and an export annotation are three different claims, and
 * the reader has to be able to tell them apart at a glance. This is the reason it stays a
 * literal rather than becoming `var(--tl-color-selected)`.
 */
const FIELD_RGB = '91, 91, 214'

export const FIELD_INK = `rgb(${FIELD_RGB})`

/** The same ink at a given alpha — circle fills, badge backgrounds, the thinking border. */
export function fieldTint(alpha: number): string {
	return `rgba(${FIELD_RGB}, ${alpha})`
}
