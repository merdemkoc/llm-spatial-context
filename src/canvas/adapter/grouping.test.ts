/**
 * @vitest-environment jsdom
 *
 * The write-back half of a grouping, against a real editor.
 *
 * `planGrouping` resolves the model's chosen ids to surviving nodes and computes
 * their tidy targets; `applyGrouping` commits those targets as one undo step. Both
 * run against a live tldraw store, because the point of the pair is what happens at
 * the seam between the canonical view and the editor's shapes.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultTools,
	Editor,
	type TLStore,
} from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { applyGrouping, planGrouping } from '@/canvas/adapter/grouping'

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let store: TLStore

beforeEach(() => {
	store = createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils })
	editor = new Editor({
		store,
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [...defaultTools],
		getContainer: () => document.createElement('div'),
	})
	registerNodeMetadata(editor)
})

function createPostIt(id: string, x: number, y: number) {
	const node = createPostItNode({ id, x, y })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

function positionOf(id: string) {
	const node = getCanvasDocument(editor).nodes[id]
	return { x: node.spatial.x, y: node.spatial.y }
}

function expectAt(id: string, target: { x: number; y: number }) {
	const at = positionOf(id)
	expect(at.x).toBeCloseTo(target.x)
	expect(at.y).toBeCloseTo(target.y)
}

describe('planGrouping', () => {
	it('returns null when fewer than two members still exist', () => {
		createPostIt('a', 0, 0)
		expect(planGrouping(editor, ['a', 'ghost'])).toBeNull()
	})

	it('drops ids with no live node and plans a target for each survivor', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 1000, 0)

		const plan = planGrouping(editor, ['a', 'b', 'ghost'])

		expect(plan?.members).toEqual(['a', 'b'])
		expect(plan?.targets.map((t) => t.id).sort()).toEqual(['a', 'b'])
	})
})

describe('applyGrouping', () => {
	it('moves every member to its planned target', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 1000, 0)
		createPostIt('c', 0, 1000)

		const plan = planGrouping(editor, ['a', 'b', 'c'])!
		expect(applyGrouping(editor, plan)).toBe(3)

		for (const target of plan.targets) expectAt(target.id, target)
	})

	it('commits as a single undo step', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 1000, 0)
		const before = { a: positionOf('a'), b: positionOf('b') }

		const plan = planGrouping(editor, ['a', 'b'])!
		applyGrouping(editor, plan)
		editor.undo()

		expect(positionOf('a')).toEqual(before.a)
		expect(positionOf('b')).toEqual(before.b)
	})

	it('skips a member deleted since the plan without throwing', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 1000, 0)
		const plan = planGrouping(editor, ['a', 'b'])!

		editor.deleteShapes([nodeIdToShapeId('b')])

		let moved = 0
		expect(() => {
			moved = applyGrouping(editor, plan)
		}).not.toThrow()
		expect(moved).toBe(1)
		expectAt('a', plan.targets.find((t) => t.id === 'a')!)
	})
})
