/**
 * @vitest-environment jsdom
 *
 * The wiring, against a real tldraw editor.
 *
 * The pure round-trip tests prove the projection is correct in isolation, but
 * they can't catch anything that goes wrong between the editor and the canonical
 * view — a meta write the record validator rejects, a change the derived view
 * doesn't notice. Both of those have bitten already, so this exercises the same
 * sequence the UI does: create a post-it, set a radius, move it, read the
 * canonical Canvas back out.
 *
 * Unlike the other suites, this one imports tldraw at runtime and therefore
 * needs a DOM. It is the only file here that does.
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
import { calculateSpatialInfluence, createPostItNode, type CanvasNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { contextualFieldPatch, nodeToShape } from '@/canvas/adapter/adapter'
import { selectedPostItIds, setContextualFieldRadius } from '@/canvas/adapter/contextualField'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'

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

/** What `PostItTool` does: build the Node first, then project it. */
function createPostIt(id: string, x: number, y: number, radius?: number) {
	const node = createPostItNode({ id, x, y, radius })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })

	return nodeIdToShapeId(id)
}

/** What the style panel's radius control does, via `updateShapes` directly. */
function setRadius(id: string, radius: number | null) {
	editor.updateShapes([
		{
			id: nodeIdToShapeId(id),
			type: POST_IT_SHAPE_TYPE,
			meta: contextualFieldPatch(radius === null ? undefined : { radius }),
		},
	])
}

/** What the style panel's radius control *actually* calls. */
function setRadiusOnSelection(radius: number | null) {
	return setContextualFieldRadius(editor, selectedPostItIds(editor), radius)
}

function readNode(id: string): CanvasNode {
	const node = getCanvasDocument(editor).nodes[id]
	expect(node, `node ${id} missing from the canonical canvas`).toBeDefined()

	return node
}

describe('creating a post-it', () => {
	it('does not throw on the record validator', () => {
		// The regression: `meta.contextualField = undefined` failed `T.jsonValue`
		// with "Expected json serializable value", so the shape never got created.
		expect(() => createPostIt('a', 0, 0)).not.toThrow()
		expect(Object.keys(getCanvasDocument(editor).nodes)).toEqual(['a'])
	})

	it('starts with no contextual field', () => {
		createPostIt('a', 0, 0)
		expect(readNode('a')).not.toHaveProperty('contextualField')
	})

	it('carries a radius through creation when the node has one', () => {
		createPostIt('a', 0, 0, 500)
		expect(readNode('a').contextualField).toEqual({ radius: 500 })
	})
})

describe('setting a radius through the editor', () => {
	it('reaches the canonical canvas', () => {
		createPostIt('a', 0, 0)
		setRadius('a', 500)

		expect(readNode('a').contextualField).toEqual({ radius: 500 })
	})

	it('leaves the other nodes alone', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 400, 0)
		setRadius('a', 500)

		expect(readNode('b')).not.toHaveProperty('contextualField')
	})

	it('preserves the timestamps it was merged over, and stamps updatedAt', () => {
		createPostIt('a', 0, 0)
		const before = readNode('a').metadata

		setRadius('a', 500)
		const after = readNode('a').metadata

		expect(after.createdAt).toBe(before.createdAt)
		expect(after.createdBy).toBe('user')
		expect(after.updatedAt >= before.updatedAt).toBe(true)
	})

	it('clears the field again', () => {
		createPostIt('a', 0, 0, 500)
		setRadius('a', null)

		expect(readNode('a')).not.toHaveProperty('contextualField')
		// The null that expresses "cleared" is an artefact of the projection and
		// must not surface in the canonical JSON.
		expect(JSON.stringify(getCanvasDocument(editor))).not.toContain('contextualField')
	})

	it('survives undo and redo', () => {
		createPostIt('a', 0, 0)
		editor.markHistoryStoppingPoint('set radius')
		setRadius('a', 500)

		editor.undo()
		expect(readNode('a')).not.toHaveProperty('contextualField')

		editor.redo()
		expect(readNode('a').contextualField).toEqual({ radius: 500 })
	})
})

describe('setting a radius on the selection, the way the panel does', () => {
	it('reaches the canonical canvas for a selected post-it', () => {
		// The user's sequence exactly: create three, select one, set 500.
		createPostIt('a', 0, 0)
		createPostIt('b', 400, 0)
		createPostIt('c', 800, 0)

		editor.select(nodeIdToShapeId('a'))
		expect(setRadiusOnSelection(500)).toBe(1)

		expect(readNode('a').contextualField).toEqual({ radius: 500 })
	})

	it('applies to every selected post-it', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 400, 0)

		editor.select(nodeIdToShapeId('a'), nodeIdToShapeId('b'))
		expect(setRadiusOnSelection(250)).toBe(2)

		expect(readNode('a').contextualField).toEqual({ radius: 250 })
		expect(readNode('b').contextualField).toEqual({ radius: 250 })
	})

	it('reports doing nothing when nothing is selected', () => {
		createPostIt('a', 0, 0)
		editor.selectNone()

		expect(setRadiusOnSelection(500)).toBe(0)
		expect(readNode('a')).not.toHaveProperty('contextualField')
	})

	it('still works while the shape is being text-edited', () => {
		// PostItTool drops a new post-it straight into text editing, so this is the
		// state the panel is most likely to be used from.
		createPostIt('a', 0, 0)
		editor.select(nodeIdToShapeId('a'))
		editor.setEditingShape(nodeIdToShapeId('a'))

		expect(setRadiusOnSelection(500)).toBe(1)
		expect(readNode('a').contextualField).toEqual({ radius: 500 })
	})

	it('clears the field on the selection', () => {
		createPostIt('a', 0, 0, 500)
		editor.select(nodeIdToShapeId('a'))

		expect(setRadiusOnSelection(null)).toBe(1)
		expect(readNode('a')).not.toHaveProperty('contextualField')
	})
})

describe('influence over a live canvas', () => {
	it('is zero until a radius is set, then follows distance', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 250, 0)

		expect(calculateSpatialInfluence(readNode('a'), readNode('b'))).toBe(0)

		setRadius('a', 500)
		expect(calculateSpatialInfluence(readNode('a'), readNode('b'))).toBeCloseTo(0.5)
	})

	it('changes when a node moves, with nothing stored', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 250, 0)

		const near = calculateSpatialInfluence(readNode('a'), readNode('b'))

		// Drag B further away.
		editor.updateShapes([{ id: nodeIdToShapeId('b'), type: POST_IT_SHAPE_TYPE, x: 400 }])
		const far = calculateSpatialInfluence(readNode('a'), readNode('b'))

		expect(near).toBeCloseTo(0.5)
		expect(far).toBeCloseTo(0.2)
		expect(far).toBeLessThan(near)
	})

	it('is directional when the two radii differ', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 100, 0, 200)

		expect(calculateSpatialInfluence(readNode('a'), readNode('b'))).toBeCloseTo(0.8)
		expect(calculateSpatialInfluence(readNode('b'), readNode('a'))).toBeCloseTo(0.5)
	})
})
