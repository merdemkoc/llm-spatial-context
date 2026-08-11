/**
 * @vitest-environment jsdom
 *
 * The demonstration seed.
 *
 * `seedDemoScene` sets up the MVP 1 §8 starting state so the walkthrough begins the same
 * way every time: three post-its, one with a contextual field, with B outside that field
 * (ready to be dragged in) and C already inside it. This pins that arrangement, and that
 * the seed replaces whatever was on the canvas rather than piling onto it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createTLStore, defaultBindingUtils, defaultShapeUtils, defaultTools, Editor } from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { seedDemoScene } from '@/canvas/dev/seedScenario'

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
})

function nodesByText() {
	const document = getCanvasDocument(editor)
	const byText: Record<string, (typeof document.nodes)[string]> = {}
	for (const node of Object.values(document.nodes)) byText[node.content.text ?? ''] = node
	return byText
}

function influence(source: string, target: string) {
	return getCanvasDocument(editor).spatialContext.influences.find(
		(row) => row.source === source && row.target === target
	)?.influence
}

describe('seedDemoScene', () => {
	it('creates three labelled post-its', () => {
		seedDemoScene(editor)

		expect(Object.keys(nodesByText()).sort()).toEqual(['A', 'B', 'C'])
	})

	it('gives A a contextual field and leaves the others without one', () => {
		seedDemoScene(editor)
		const { A, B, C } = nodesByText()

		expect(A.contextualField?.radius).toBeGreaterThan(0)
		expect(B.contextualField).toBeUndefined()
		expect(C.contextualField).toBeUndefined()
	})

	it('starts B outside A’s field and C inside it', () => {
		seedDemoScene(editor)
		const { A, B, C } = nodesByText()

		expect(influence(A.id, B.id)).toBe(0)
		expect(influence(A.id, C.id)).toBeGreaterThan(0)
	})

	it('replaces whatever was already on the canvas', () => {
		editor.createShape({
			...nodeToShape(createPostItNode({ id: 'stray', x: 0, y: 0, text: 'stray' })),
			parentId: editor.getCurrentPageId(),
		})

		seedDemoScene(editor)

		expect(Object.keys(nodesByText()).sort()).toEqual(['A', 'B', 'C'])
	})
})
