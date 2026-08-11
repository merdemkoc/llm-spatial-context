/**
 * The one piece of behaviour in the root model: how a gravity is read.
 *
 * Every gravity arrives from somewhere untrusted — `shape.meta`, which tldraw
 * stores without inspecting, or an imported document typed by assertion — so what
 * this function does with a wrong value *is* the field's contract. The two rules
 * worth pinning are that a missing gravity means the full-strength claim drawing
 * an arrow made, and that a deliberate `0` is not treated as missing.
 */
import { describe, expect, it } from 'vitest'
import { clampGravity, DEFAULT_RELATION_GRAVITY } from '@/domain/canvas'

describe('clampGravity', () => {
	it('keeps a value already in range', () => {
		expect(clampGravity(0.35)).toBe(0.35)
		expect(clampGravity(1)).toBe(1)
	})

	/**
	 * "Connected, but the user says barely" is a claim they made. Reading it back as
	 * the default would silently overrule them — the same reason a
	 * `contextualField.radius` of `0` is kept rather than scrubbed.
	 */
	it('keeps a deliberate zero', () => {
		expect(clampGravity(0)).toBe(0)
	})

	it('defaults when there is no usable number', () => {
		expect(clampGravity(undefined)).toBe(DEFAULT_RELATION_GRAVITY)
		expect(clampGravity(null)).toBe(DEFAULT_RELATION_GRAVITY)
		expect(clampGravity('0.5')).toBe(DEFAULT_RELATION_GRAVITY)
		expect(clampGravity({ gravity: 0.5 })).toBe(DEFAULT_RELATION_GRAVITY)
	})

	/** NaN fails every comparison, so it would slip past a bare clamp and leak out. */
	it('defaults for NaN and infinities', () => {
		expect(clampGravity(NaN)).toBe(DEFAULT_RELATION_GRAVITY)
		expect(clampGravity(Infinity)).toBe(DEFAULT_RELATION_GRAVITY)
		expect(clampGravity(-Infinity)).toBe(DEFAULT_RELATION_GRAVITY)
	})

	/** Out of range is a broken scale, not a different claim — so it's clamped, not rejected. */
	it('clamps into 0–1', () => {
		expect(clampGravity(7)).toBe(1)
		expect(clampGravity(1.0001)).toBe(1)
		expect(clampGravity(-0.5)).toBe(0)
	})

	/** Rounded once, here, so the store, the JSON and the UI can't disagree. */
	it('rounds to three decimals', () => {
		expect(clampGravity(0.1234)).toBe(0.123)
		expect(clampGravity(1 / 3)).toBe(0.333)
	})

	it('is the full-strength claim by default', () => {
		expect(DEFAULT_RELATION_GRAVITY).toBe(1)
	})
})
