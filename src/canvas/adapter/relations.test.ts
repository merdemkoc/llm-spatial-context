/**
 * The pure half of the relation projection: what makes an arrow a relation, and
 * what its label says.
 *
 * No editor here — bindings need one, and those are covered in
 * `relationEditor.test.ts`. What's testable without one is the tagging rule and
 * the label, and the label carries the rule that matters most: an empty one
 * produces no `type` at all rather than an empty string.
 */
import { describe, expect, it } from 'vitest'
import type { TLShape } from 'tldraw'
import { isRelationArrow, relationGravity, relationType } from '@/canvas/adapter/relations'
import { plainTextToRichText } from '@/canvas/adapter/richText'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'

/** Only the fields the projection reads; a full TLShape is noise here. */
function shape(type: string, meta: Record<string, unknown> = {}, label?: string): TLShape {
	return {
		id: 'shape:a',
		type,
		meta,
		props: label === undefined ? {} : { richText: plainTextToRichText(label) },
	} as unknown as TLShape
}

function arrow(label?: string, meta: Record<string, unknown> = { relation: true }): TLShape {
	return shape('arrow', meta, label)
}

describe('isRelationArrow', () => {
	it('accepts an arrow the relation tool tagged', () => {
		expect(isRelationArrow(arrow())).toBe(true)
	})

	/** The whole point of the tag: a plain arrow is decoration, not a claim. */
	it('rejects an untagged arrow', () => {
		expect(isRelationArrow(shape('arrow'))).toBe(false)
	})

	it('rejects a tagged shape that is not an arrow', () => {
		expect(isRelationArrow(shape(POST_IT_SHAPE_TYPE, { relation: true }))).toBe(false)
	})

	/** `meta` is unvalidated JSON, so the flag is read defensively like the rest. */
	it('rejects a tag that is not a boolean true', () => {
		expect(isRelationArrow(arrow(undefined, { relation: 'yes' }))).toBe(false)
		expect(isRelationArrow(arrow(undefined, { relation: false }))).toBe(false)
	})
})

describe('relationType', () => {
	it('is the arrow’s label', () => {
		expect(relationType(arrow('causes'))).toBe('causes')
	})

	/**
	 * Absent, not empty. "Connected, and the user didn't say why" is a different
	 * claim from a relation named `""`, and the JSON should show the difference.
	 */
	it('is undefined for an unlabelled arrow', () => {
		expect(relationType(arrow(''))).toBeUndefined()
		expect(relationType(arrow())).toBeUndefined()
	})

	it('is undefined for a label that is only whitespace', () => {
		expect(relationType(arrow('   '))).toBeUndefined()
	})

	it('trims the label', () => {
		expect(relationType(arrow('  supports  '))).toBe('supports')
	})

	it('keeps a multi-word label intact', () => {
		expect(relationType(arrow('leads to'))).toBe('leads to')
	})
})

describe('relationGravity', () => {
	it('is the value stored on the arrow', () => {
		expect(relationGravity(arrow(undefined, { relation: true, gravity: 0.35 }))).toBe(0.35)
		expect(relationGravity(arrow(undefined, { relation: true, gravity: 0 }))).toBe(0)
	})

	/**
	 * An arrow drawn before gravity existed is still a relation the user drew, and
	 * drawing it is what the default means. This is what keeps an old canvas — or an
	 * imported document written against the previous schema — readable.
	 */
	it('is the full-strength default when the arrow carries none', () => {
		expect(relationGravity(arrow())).toBe(1)
	})

	/** `meta` is unvalidated JSON, so a nonsense value is read as defensively as the flag. */
	it('ignores a stored value that is not a usable number', () => {
		expect(relationGravity(arrow(undefined, { relation: true, gravity: '0.5' }))).toBe(1)
		expect(relationGravity(arrow(undefined, { relation: true, gravity: null }))).toBe(1)
	})

	it('clamps a stored value into 0–1', () => {
		expect(relationGravity(arrow(undefined, { relation: true, gravity: 5 }))).toBe(1)
		expect(relationGravity(arrow(undefined, { relation: true, gravity: -2 }))).toBe(0)
	})

	/** The one thing it must never do: notice how the arrow is drawn. */
	it('is unaffected by the arrow’s label', () => {
		expect(relationGravity(arrow('causes', { relation: true, gravity: 0.2 }))).toBe(0.2)
	})
})
