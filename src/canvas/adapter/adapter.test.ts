/**
 * The round-trip invariant.
 *
 *   Canonical Node → tldraw shape → user interaction → tldraw shape → Node
 *
 * These run in plain Node: the adapter, the domain and the shape type module
 * all import tldraw for types only, so nothing here needs a DOM or a live
 * editor.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type PostItNode } from '@/domain'
import {
	contextualFieldPatch,
	nodeToShape,
	readNodeContextualField,
	readNodeMeta,
	shapeToNode,
} from '@/canvas/adapter/adapter'
import { nodeIdToShapeId, shapeIdToNodeId } from '@/canvas/adapter/ids'
import { plainTextToRichText, richTextToPlainText } from '@/canvas/adapter/richText'
import { POST_IT_SHAPE_TYPE, type PostItShape } from '@/canvas/shapes/postItShape'

/**
 * `nodeToShape` returns a partial, because the editor owns the fields it fills
 * in. Completing it here is what the editor does on create.
 */
function toShape(node: PostItNode): PostItShape {
	const partial = nodeToShape(node)

	return {
		...partial,
		typeName: 'shape',
		parentId: 'page:page',
		isLocked: false,
	} as PostItShape
}

function roundTrip(node: PostItNode): PostItNode {
	return shapeToNode(toShape(node))
}

const NOW = '2026-08-09T12:00:00.000Z'

function sampleNode(overrides: Partial<Parameters<typeof createPostItNode>[0]> = {}) {
	return createPostItNode({
		id: 'a4f1c2d3-0000-4000-8000-000000000001',
		x: 400,
		y: 200,
		text: "Users don't trust roaming prices.",
		now: NOW,
		...overrides,
	})
}

describe('node ↔ shape round trip', () => {
	it('preserves every field the invariant covers', () => {
		const node = sampleNode({
			width: 320,
			height: 180,
			rotation: 0,
			order: 'a2',
			visual: {
				fill: '#FFF59D',
				stroke: '#000000',
				opacity: 0.8,
				textColor: '#1565C0',
			},
		})

		expect(roundTrip(node)).toEqual(node)
	})

	it('survives rotation', () => {
		// The case that catches reaching for getShapePageBounds(), which returns
		// the axis-aligned box of the *rotated* shape rather than x/y/w/h.
		const node = sampleNode({ rotation: Math.PI / 6 })
		const result = roundTrip(node)

		expect(result.spatial.rotation).toBe(Math.PI / 6)
		expect(result.spatial.x).toBe(node.spatial.x)
		expect(result.spatial.y).toBe(node.spatial.y)
		expect(result.spatial.width).toBe(node.spatial.width)
		expect(result.spatial.height).toBe(node.spatial.height)
	})

	it('preserves stacking order', () => {
		expect(roundTrip(sampleNode({ order: 'a3V' })).spatial.order).toBe('a3V')
	})

	it('preserves multi-line and empty text', () => {
		expect(roundTrip(sampleNode({ text: 'first\n\nthird' })).content.text).toBe('first\n\nthird')
		expect(roundTrip(sampleNode({ text: '' })).content.text).toBe('')
	})

	it('preserves metadata', () => {
		const node = sampleNode({ createdBy: 'agent' })
		const result = roundTrip(node)

		expect(result.metadata).toEqual({
			createdAt: NOW,
			updatedAt: NOW,
			createdBy: 'agent',
		})
	})

	it('preserves the contextual field', () => {
		// The radius can't be derived back out of a tldraw shape the way geometry
		// can, so if the adapter didn't carry it in meta it would vanish on
		// reload and be dropped by every import.
		expect(roundTrip(sampleNode({ radius: 500 })).contextualField).toEqual({ radius: 500 })
		expect(roundTrip(sampleNode({ radius: 0 })).contextualField).toEqual({ radius: 0 })
	})

	it('leaves a node without a field without the key', () => {
		// toStrictEqual, so `contextualField: undefined` would fail here.
		expect(roundTrip(sampleNode())).toStrictEqual(sampleNode())
		expect(JSON.stringify(roundTrip(sampleNode()))).not.toContain('contextualField')
	})

	it('reads a shape whose world position differs from its local position', () => {
		// A post-it nested in a frame or group reports parent-relative x/y, so
		// call sites pass the decomposed page transform instead.
		const shape = toShape(sampleNode({ x: 10, y: 20 }))
		const node = shapeToNode(shape, { x: 410, y: 220, rotation: 1 })

		expect(node.spatial.x).toBe(410)
		expect(node.spatial.y).toBe(220)
		expect(node.spatial.rotation).toBe(1)
	})
})

describe('serialization', () => {
	it('survives a JSON round trip', () => {
		const node = sampleNode()
		expect(JSON.parse(JSON.stringify(node))).toEqual(node)
	})

	it('leaks no tldraw representation', () => {
		const json = JSON.stringify(sampleNode())

		expect(json).not.toContain('shape:')
		expect(json).not.toContain('typeName')
		expect(json).not.toContain('parentId')
		expect(json).not.toContain('richText')
		expect(json).not.toContain('props')
	})

	it('uses the canonical node type, not the tldraw shape type', () => {
		expect(sampleNode().type).toBe('post_it')
		expect(POST_IT_SHAPE_TYPE).toBe('post-it')
		expect(nodeToShape(sampleNode()).type).toBe('post-it')
	})
})

describe('identity', () => {
	it('maps node ids to shape ids and back exactly', () => {
		const nodeId = 'a4f1c2d3-0000-4000-8000-000000000001'

		expect(nodeIdToShapeId(nodeId)).toBe(`shape:${nodeId}`)
		expect(shapeIdToNodeId(nodeIdToShapeId(nodeId))).toBe(nodeId)
	})

	it('is stable across spatial and visual change', () => {
		const node = sampleNode()
		const moved: PostItNode = {
			...node,
			spatial: { ...node.spatial, x: 999, y: -12, rotation: 2, width: 50, height: 60 },
			visual: { ...node.visual, fill: '#90CAF9', opacity: 0.1 },
		}

		expect(roundTrip(moved).id).toBe(node.id)
	})
})

describe('rich text', () => {
	it('round-trips plain text', () => {
		for (const text of ['', 'one', 'one\ntwo', 'a\n\nb', 'trailing\n']) {
			expect(richTextToPlainText(plainTextToRichText(text))).toBe(text)
		}
	})

	it('reads text out of formatted content', () => {
		const formatted = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'plain ' },
						{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
					],
				},
			],
		}

		expect(richTextToPlainText(formatted)).toBe('plain bold')
	})

	it('loses formatting when a shape is rebuilt from canonical JSON', () => {
		// Pinning the known limitation rather than leaving it to a comment:
		// content.text survives, the marks that produced it do not.
		const formatted = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'plain ' },
						{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
					],
				},
			],
		}

		const shape = { ...toShape(sampleNode()), props: { ...toShape(sampleNode()).props } }
		shape.props.richText = formatted

		const node = shapeToNode(shape)
		expect(node.content.text).toBe('plain bold')

		const rebuilt = nodeToShape(node)
		expect(rebuilt.props?.richText).toEqual(plainTextToRichText('plain bold'))
		// The text survives; the marks that formatted it do not.
		expect(JSON.stringify(rebuilt.props?.richText)).not.toContain('marks')
	})

	it('handles undefined rich text', () => {
		expect(richTextToPlainText(undefined)).toBe('')
	})
})

describe('metadata reads', () => {
	it('falls back when meta is missing or malformed', () => {
		expect(readNodeMeta(undefined).createdBy).toBe('user')
		expect(readNodeMeta({ createdBy: 'nonsense' }).createdBy).toBe('user')
		expect(readNodeMeta({ createdAt: 42 }).createdAt).toBe('1970-01-01T00:00:00.000Z')
	})

	it('keeps valid values', () => {
		expect(readNodeMeta({ createdAt: NOW, updatedAt: NOW, createdBy: 'system' })).toEqual({
			createdAt: NOW,
			updatedAt: NOW,
			createdBy: 'system',
		})
	})
})

describe('contextual field reads', () => {
	it('returns undefined for anything that is not a field', () => {
		for (const meta of [
			undefined,
			{},
			{ contextualField: null },
			{ contextualField: 500 },
			{ contextualField: [500] },
			{ contextualField: {} },
			{ contextualField: { radius: '500' } },
			{ contextualField: { radius: Number.POSITIVE_INFINITY } },
		]) {
			expect(readNodeContextualField(meta)).toBeUndefined()
		}
	})

	it('keeps a non-positive radius rather than scrubbing it', () => {
		// "No reach" is a legitimate state that the influence calculation already
		// understands; discarding it here would turn it back into "no field".
		expect(readNodeContextualField({ contextualField: { radius: 0 } })).toEqual({ radius: 0 })
		expect(readNodeContextualField({ contextualField: { radius: -10 } })).toEqual({ radius: -10 })
	})

	it('ignores extra keys inside the field', () => {
		expect(readNodeContextualField({ contextualField: { radius: 250, strength: 0.5 } })).toEqual({
			radius: 250,
		})
	})
})

/**
 * `shape.meta` is validated as JSON: `T.jsonValue` walks it and throws
 * "Expected json serializable value" on any `undefined` it finds. That is not
 * something the record shrugs off — it rejects the whole write, so an
 * `undefined` anywhere in meta makes creating a post-it fail outright.
 *
 * Mirrors that check by asserting the value survives a JSON round trip
 * unchanged. `toStrictEqual` is required: `toEqual` treats `{ a: undefined }`
 * and `{}` as equal, which is exactly the difference being tested.
 */
function expectJsonSerializable(value: object) {
	expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
}

describe('contextual field writes', () => {
	it('writes meta that passes JSON validation, with and without a field', () => {
		expectJsonSerializable(nodeToShape(sampleNode()).meta!)
		expectJsonSerializable(nodeToShape(sampleNode({ radius: 500 })).meta!)
	})

	it('names no contextualField key on a node without a field', () => {
		expect(nodeToShape(sampleNode()).meta).not.toHaveProperty('contextualField')
	})

	const existing = {
		createdAt: NOW,
		updatedAt: NOW,
		createdBy: 'user',
		contextualField: { radius: 500 },
	}

	/** What tldraw's `applyPartialToRecordWithProps` does to a meta patch. */
	function applyPatch(patch: object) {
		return { ...existing, ...patch }
	}

	it('sets a radius through a patch, leaving the timestamps alone', () => {
		const merged = applyPatch(contextualFieldPatch({ radius: 120 }))

		expect(readNodeContextualField(merged)).toEqual({ radius: 120 })
		expect(readNodeMeta(merged).createdAt).toBe(NOW)
	})

	it('clears the field through a patch, using null rather than undefined', () => {
		// The two constraints that pin this down: tldraw merges meta patches key by
		// key, so an omitted key would leave the old radius in place and "Clear"
		// would silently do nothing — and `undefined` would fail JSON validation.
		const patch = contextualFieldPatch(undefined)
		expect(patch).toEqual({ contextualField: null })
		expectJsonSerializable(patch)

		const merged = applyPatch(patch)
		expect(readNodeContextualField(merged)).toBeUndefined()
		expect(readNodeMeta(merged).createdBy).toBe('user')
	})

	it('keeps a cleared field out of the canonical node entirely', () => {
		// The null is an artefact of the projection, not part of the model.
		const shape = { ...toShape(sampleNode()), meta: applyPatch(contextualFieldPatch(undefined)) }
		const node = shapeToNode(shape)

		expect(node).not.toHaveProperty('contextualField')
		expect(JSON.stringify(node)).not.toContain('contextualField')
	})
})
