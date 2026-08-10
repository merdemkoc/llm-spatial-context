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
import { nodeToShape, readNodeMeta, shapeToNode } from '@/canvas/adapter/adapter'
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
