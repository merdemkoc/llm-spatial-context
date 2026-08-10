/**
 * @vitest-environment jsdom
 *
 * The grounding map, against a real tldraw editor.
 *
 * The pure suites prove the ordering and the geometry in isolation. What they
 * can't prove is the claim the whole feature rests on: that every label in
 * `grounding` resolves to a node that is actually in the canonical JSON. That
 * needs a real document, built the way the app builds one.
 *
 * The pixels are not tested here. `toImage` and `createImageBitmap` need a real
 * browser, so `exportGroundedCanvas` is verified by hand — which is why
 * everything that can be wrong about a box's position lives in the pure modules
 * instead of in it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createTLStore, defaultBindingUtils, defaultShapeUtils, defaultTools, Editor } from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { groundedDocument } from '@/canvas/grounding/groundedExport'

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor

beforeEach(() => {
	editor = new Editor({
		store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [...defaultTools],
		getContainer: () => document.createElement('div'),
	})

	registerNodeMetadata(editor)
})

function createPostIt(id: string, x: number, y: number, text?: string) {
	const node = createPostItNode({ id, x, y, text })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

function grounded() {
	return groundedDocument(getCanvasDocument(editor))
}

describe('groundedDocument', () => {
	it('grounds every node in the canonical JSON, and nothing else', () => {
		createPostIt('aeb30231', 0, 0)
		createPostIt('cb19cf1f', 400, 0)
		createPostIt('239a3b4e', 0, 400)

		const document = grounded()

		expect(Object.keys(document.grounding)).toEqual(['N1', 'N2', 'N3'])
		expect(Object.values(document.grounding).sort()).toEqual(Object.keys(document.nodes).sort())
	})

	/** The point of the map: a label is resolvable to a node without guessing. */
	it('maps labels to ids that resolve in `nodes`', () => {
		createPostIt('left', 0, 0, 'left note')
		createPostIt('right', 400, 0, 'right note')

		const document = grounded()

		expect(document.nodes[document.grounding.N1].content.text).toBe('left note')
		expect(document.nodes[document.grounding.N2].content.text).toBe('right note')
	})

	it('labels in reading order across a real layout', () => {
		createPostIt('bottom', 0, 900)
		createPostIt('top-right', 400, 0)
		createPostIt('top-left', 0, 0)

		expect(grounded().grounding).toEqual({
			N1: 'top-left',
			N2: 'top-right',
			N3: 'bottom',
		})
	})

	/**
	 * `grounding` is an export concern, so the canonical document travels through
	 * untouched — a grounded artifact is a superset that the Inspector's import
	 * still accepts.
	 */
	it('adds `grounding` and changes nothing else', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 300, 120)

		const canvas = getCanvasDocument(editor)
		const { grounding, ...rest } = groundedDocument(canvas)

		expect(grounding).toBeDefined()
		expect(rest).toEqual(canvas)
	})

	it('grounds nothing on an empty canvas', () => {
		expect(grounded().grounding).toEqual({})
	})
})
