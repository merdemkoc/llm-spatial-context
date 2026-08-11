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
import {
	calculateSpatialInfluence,
	createPostItNode,
	type CanvasDocument,
	type CanvasNode,
} from '@/domain'
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

describe('spatialContext in the canonical document', () => {
	function context() {
		return getCanvasDocument(editor).spatialContext
	}

	function entry(source: string, target: string) {
		const found = context().influences.find((i) => i.source === source && i.target === target)
		expect(found, `no influence entry for ${source} → ${target}`).toBeDefined()

		return found!
	}

	it('appears for a canvas of three nodes, as every directed pair', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 400, 0, 500)
		createPostIt('c', 800, 0)

		expect(context().influences).toHaveLength(6)
	})

	it('is present and empty rather than absent on a bare canvas', () => {
		expect(context()).toEqual({ influences: [] })
	})

	it('recalculates when a node moves — closer means more influence', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 400, 0)

		const before = entry('a', 'b')

		editor.updateShapes([{ id: nodeIdToShapeId('b'), type: POST_IT_SHAPE_TYPE, x: 200 }])
		const after = entry('a', 'b')

		expect(after.distance).toBeLessThan(before.distance)
		expect(after.influence).toBeGreaterThan(before.influence)
	})

	it('drops to zero once a node is moved out of the field', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 200, 0)

		expect(entry('a', 'b').influence).toBeGreaterThan(0)

		editor.updateShapes([{ id: nodeIdToShapeId('b'), type: POST_IT_SHAPE_TYPE, x: 5000 }])

		// The pair is kept rather than omitted: "out of range" and "not considered"
		// have to stay tellable apart.
		expect(entry('a', 'b').influence).toBe(0)
	})

	it('recalculates when a node is resized', () => {
		// Size moves the centre, so it moves the distance too.
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 400, 0)

		const before = entry('a', 'b').distance

		editor.updateShapes([{ id: nodeIdToShapeId('b'), type: POST_IT_SHAPE_TYPE, props: { w: 400 } }])

		expect(entry('a', 'b').distance).not.toBe(before)
	})

	it('recalculates when a radius changes', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 250, 0)

		expect(entry('a', 'b').influence).toBeCloseTo(0.5)

		setRadius('a', 1000)
		expect(entry('a', 'b').influence).toBeCloseTo(0.75)

		setRadius('a', null)
		expect(entry('a', 'b').influence).toBe(0)
	})

	it('recalculates when a node is added or deleted', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 400, 0, 500)
		expect(context().influences).toHaveLength(2)

		createPostIt('c', 800, 0, 500)
		expect(context().influences).toHaveLength(6)

		editor.deleteShapes([nodeIdToShapeId('c')])
		expect(context().influences).toHaveLength(2)
	})

	it('keeps both directions when the radii differ', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 100, 0, 200)

		expect(entry('a', 'b').influence).toBeCloseTo(0.8)
		expect(entry('b', 'a').influence).toBeCloseTo(0.5)
	})

	it('rounds for the document without touching the nodes', () => {
		createPostIt('a', 0, 0, 700)
		createPostIt('b', 301, 400)

		const { distance, influence } = entry('a', 'b')

		expect(Number.isInteger(distance)).toBe(true)
		expect(influence).toBe(Math.round(influence * 1000) / 1000)
	})

	it('stores nothing: the influence never reaches a shape or a node', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 250, 0, 500)

		expect(entry('a', 'b').influence).toBeGreaterThan(0)

		for (const shape of editor.getCurrentPageShapes()) {
			expect(JSON.stringify(shape.meta)).not.toContain('influence')
		}
		for (const node of Object.values(getCanvasDocument(editor).nodes)) {
			expect(node).not.toHaveProperty('influence')
			expect(node).not.toHaveProperty('spatialContext')
		}
	})

	it('keeps relations separate, and infers none from proximity', () => {
		// Two nodes deep inside each other's fields still produce no relation.
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 10, 0, 500)

		const document = getCanvasDocument(editor)

		expect(document.spatialContext.influences[0].influence).toBeGreaterThan(0.9)
		expect(document.relations).toEqual({})
		expect(JSON.stringify(document.spatialContext)).not.toContain('type')
	})

	it('is output, not input: an imported spatialContext is recomputed', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 250, 0)

		// What the Inspector's import path does — it reads `nodes` and nothing else.
		const exported = JSON.parse(JSON.stringify(getCanvasDocument(editor))) as CanvasDocument
		exported.spatialContext = {
			influences: [{ source: 'a', target: 'b', distance: 9, influence: 9 }],
		}

		editor.deleteShapes(editor.getCurrentPageShapes().map((shape) => shape.id))
		editor.createShapes(
			Object.values(exported.nodes).map((node) => ({
				...nodeToShape(node),
				parentId: editor.getCurrentPageId(),
			}))
		)

		// The nonsense values are gone; the radius that survived the import drives
		// a freshly derived context.
		expect(entry('a', 'b').influence).toBeCloseTo(0.5)
	})

	it('lays the document out as four distinct layers', () => {
		createPostIt('a', 0, 0, 500)

		expect(Object.keys(getCanvasDocument(editor))).toEqual([
			'id',
			'nodes',
			'relations',
			'spatialContext',
			'grounding',
			'metadata',
		])
	})
})

describe('grounding in the canonical document', () => {
	function grounding() {
		return getCanvasDocument(editor).grounding
	}

	it('grounds every node, in reading order', () => {
		createPostIt('bottom', 0, 900)
		createPostIt('top', 0, 0)

		expect(Object.entries(grounding().nodes).map(([id, region]) => [id, region.nodeId])).toEqual([
			['N1', 'top'],
			['N2', 'bottom'],
		])
	})

	it('maps every visual id to a node that is in the document', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 400, 0)

		const document = getCanvasDocument(editor)

		for (const region of Object.values(document.grounding.nodes)) {
			expect(document.nodes[region.nodeId]).toBeDefined()
		}
	})

	/**
	 * The distinction the layer exists for: `spatial` is canvas coordinates,
	 * `bbox` is screenshot pixels. They must not be the same numbers.
	 */
	it('reports bboxes in screenshot pixels, not canvas coordinates', () => {
		createPostIt('a', 300, 200)

		const document = getCanvasDocument(editor)

		expect(document.nodes.a.spatial).toMatchObject({ x: 300, y: 200, width: 240, height: 160 })
		expect(document.grounding.nodes.N1.bbox).toEqual([80, 80, 560, 400])
	})

	it('is present and empty rather than absent on a bare canvas', () => {
		expect(grounding().nodes).toEqual({})
	})

	it('recalculates when a node moves', () => {
		createPostIt('a', 0, 0)
		const before = grounding().nodes.N1.bbox

		editor.updateShapes([{ id: nodeIdToShapeId('a'), type: POST_IT_SHAPE_TYPE, x: 500, y: 0 }])

		// The node moved right, but the image is sized to the nodes, so its bbox
		// stays put while the image gets wider.
		expect(grounding().nodes.N1.bbox).toEqual(before)
		expect(grounding().image.width).toBeGreaterThan(0)
	})

	it('is output, not input: an imported grounding is recomputed', () => {
		createPostIt('a', 0, 0)

		const exported = JSON.parse(JSON.stringify(getCanvasDocument(editor))) as CanvasDocument
		exported.grounding = {
			image: { width: 1, height: 1 },
			nodes: { N9: { nodeId: 'nonsense', bbox: [1, 2, 3, 4] } },
		}

		editor.deleteShapes(editor.getCurrentPageShapes().map((shape) => shape.id))
		editor.createShapes(
			Object.values(exported.nodes).map((node) => ({
				...nodeToShape(node),
				parentId: editor.getCurrentPageId(),
			}))
		)

		expect(Object.keys(grounding().nodes)).toEqual(['N1'])
		expect(grounding().nodes.N1.nodeId).toBe('a')
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
