/**
 * @vitest-environment jsdom
 *
 * The grounding layer, against a real tldraw editor.
 *
 * The pure suites prove the ordering and the geometry in isolation. What they
 * can't prove is the claim the whole feature rests on: that every label resolves
 * to a node that is actually in the canonical JSON, and that its bbox is in
 * screenshot pixels rather than canvas coordinates. That needs a real document,
 * built the way the app builds one.
 *
 * The pixels are not tested here. `toImage` and `createImageBitmap` need a real
 * browser, so `exportGroundedScreenshot` is verified by hand — which is why
 * everything that can be wrong about a box's position lives in the pure modules
 * instead of in it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
	createShapeId,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultTools,
	Editor,
} from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import {
	ARROW_SHAPE_TYPE,
	RELATION_GRAVITY_META_KEY,
	RELATION_META_KEY,
} from '@/canvas/adapter/relations'
import { GROUNDING_PADDING } from '@/canvas/grounding/annotationLayer'
import { buildGrounding, groundedDocument, relationAnnotations } from '@/canvas/grounding/grounding'
import { groundingProjection } from '@/canvas/grounding/projection'
import { assignRelationVisualIds, assignVisualIds } from '@/canvas/grounding/visualId'
import { getRelationGeometry } from '@/canvas/adapter/relationGeometry'

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

/** What tldraw's bitmap export actually produces: `scale` 1 × `pixelRatio` 2. */
const EXPORT_SCALE = 2

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

/**
 * The same sequence `buildGroundedScreenshot` runs, minus the rasterising —
 * including the arrow geometry, without which the export box and every badge would
 * be computed from the nodes alone. That was the bug this mirrors.
 */
function grounded() {
	const canvas = getCanvasDocument(editor)
	const nodes = Object.values(canvas.nodes)

	const labelled = assignVisualIds(nodes)
	const geometry = getRelationGeometry(editor, canvas.relations)
	const projection = groundingProjection(nodes, GROUNDING_PADDING, geometry)

	return groundedDocument(
		canvas,
		buildGrounding(
			labelled,
			projection,
			{
				width: projection.width * EXPORT_SCALE,
				height: projection.height * EXPORT_SCALE,
			},
			assignRelationVisualIds(geometry)
		)
	)
}

describe('the grounded document', () => {
	it('grounds every node in the canonical JSON, and nothing else', () => {
		createPostIt('aeb30231', 0, 0)
		createPostIt('cb19cf1f', 400, 0)
		createPostIt('239a3b4e', 0, 400)

		const document = grounded()

		expect(Object.keys(document.grounding.nodes)).toEqual(['N1', 'N2', 'N3'])
		expect(
			Object.values(document.grounding.nodes)
				.map((region) => region.nodeId)
				.sort()
		).toEqual(Object.keys(document.nodes).sort())
	})

	/** The point of the map: a label is resolvable to a node without guessing. */
	it('maps labels to ids that resolve in `nodes`', () => {
		createPostIt('left', 0, 0, 'left note')
		createPostIt('right', 400, 0, 'right note')

		const { nodes, grounding } = grounded()

		expect(nodes[grounding.nodes.N1.nodeId].content.text).toBe('left note')
		expect(nodes[grounding.nodes.N2.nodeId].content.text).toBe('right note')
	})

	it('labels in reading order across a real layout', () => {
		createPostIt('bottom', 0, 900)
		createPostIt('top-right', 400, 0)
		createPostIt('top-left', 0, 0)

		const { grounding } = grounded()

		expect(
			Object.entries(grounding.nodes).map(([visualId, { nodeId }]) => [visualId, nodeId])
		).toEqual([
			['N1', 'top-left'],
			['N2', 'top-right'],
			['N3', 'bottom'],
		])
	})

	/**
	 * The distinction the layer exists for. `spatial` is the canvas coordinate
	 * system; `bbox` is the screenshot's. A node 900 units down the canvas is
	 * 1880px down the image, and conflating the two is the mistake this makes
	 * impossible to make.
	 */
	it('reports bboxes in screenshot pixels, not canvas coordinates', () => {
		createPostIt('top', 0, 0)
		createPostIt('bottom', 0, 900)

		const { nodes, grounding } = grounded()

		expect(nodes.top.spatial).toMatchObject({ x: 0, y: 0, width: 240, height: 160 })
		expect(grounding.nodes.N1.bbox).toEqual([80, 80, 560, 400])

		expect(nodes.bottom.spatial.y).toBe(900)
		expect(grounding.nodes.N2.bbox).toEqual([80, 1880, 560, 2200])
	})

	it('keeps every bbox inside the image it reports', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 700, 300)
		createPostIt('c', -300, 500)

		const { grounding } = grounded()

		for (const { bbox } of Object.values(grounding.nodes)) {
			expect(bbox[0]).toBeGreaterThanOrEqual(0)
			expect(bbox[1]).toBeGreaterThanOrEqual(0)
			expect(bbox[2]).toBeLessThanOrEqual(grounding.image.width)
			expect(bbox[3]).toBeLessThanOrEqual(grounding.image.height)
		}
	})

	/**
	 * The export replaces the derived grounding with a measured one and touches
	 * nothing else. That the two come out equal is the claim that makes a live
	 * document's grounding trustworthy: the prediction `getCanvasDocument` makes is
	 * the size the export actually rasterises at.
	 */
	it('replaces only the grounding layer, with the same numbers', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 300, 120)

		const { grounding: derived, ...canvasRest } = getCanvasDocument(editor)
		const { grounding: measured, ...rest } = grounded()

		expect(rest).toEqual(canvasRest)
		expect(measured).toEqual(derived)
	})

	it('grounds nothing on an empty canvas', () => {
		expect(grounded().grounding.nodes).toEqual({})
	})
})

describe('relation badges over a real document', () => {
	/** An arrow bound at both ends, as the Relation tool leaves one. */
	function createRelationArrow(from: string, to: string, gravity?: number) {
		const id = createShapeId()

		editor.createShape({
			id,
			type: ARROW_SHAPE_TYPE,
			parentId: editor.getCurrentPageId(),
			meta: {
				[RELATION_META_KEY]: true,
				...(gravity === undefined ? {} : { [RELATION_GRAVITY_META_KEY]: gravity }),
			},
		})

		editor.createBindings(
			(['start', 'end'] as const).map((terminal) => ({
				type: ARROW_SHAPE_TYPE,
				fromId: id,
				toId: nodeIdToShapeId(terminal === 'start' ? from : to),
				props: {
					terminal,
					normalizedAnchor: { x: 0.5, y: 0.5 },
					isExact: false,
					isPrecise: false,
				},
			}))
		)
	}

	/** The badges the export would draw, from the same document it would draw them for. */
	function badges() {
		const canvas = grounded()
		const geometry = getRelationGeometry(editor, canvas.relations)
		const projection = groundingProjection(Object.values(canvas.nodes), GROUNDING_PADDING, geometry)

		return relationAnnotations(
			canvas.relations,
			assignRelationVisualIds(geometry),
			projection,
			EXPORT_SCALE
		)
	}

	it('labels the relation the document reports, at the strength it reports', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 900, 400)
		createRelationArrow('a', 'b', 0.35)

		expect(badges()).toEqual([{ label: 'R1 g 0.35', at: expect.anything() }])
	})

	/**
	 * The sibling of "keeps every bbox inside the image": a badge outside the PNG is
	 * a claim nobody can see. It used to hold by construction, because a midpoint
	 * between two nodes is inside the box containing them. Now that the point is
	 * measured off the drawn path — which can bow outside the nodes — it holds
	 * because the projection unions the arrows' own bounds. This is what pins that.
	 */
	it('keeps every badge inside the image', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 700, 300)
		createPostIt('c', -300, 500)
		createRelationArrow('a', 'b')
		createRelationArrow('c', 'b')

		const { grounding } = grounded()

		expect(badges()).toHaveLength(2)
		for (const { at } of badges()) {
			expect(at.x).toBeGreaterThanOrEqual(0)
			expect(at.y).toBeGreaterThanOrEqual(0)
			expect(at.x).toBeLessThanOrEqual(grounding.image.width)
			expect(at.y).toBeLessThanOrEqual(grounding.image.height)
		}
	})

	it('gives each badge its own label so two arrows are distinguishable', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 700, 300)
		createRelationArrow('a', 'b')
		createRelationArrow('b', 'a')

		// Two relations at the default gravity used to produce two identical `g 1.00`
		// badges with nothing to tell them apart.
		const labels = badges().map((badge) => badge.label)

		expect(new Set(labels).size).toBe(2)
		expect(labels.every((label) => label.endsWith('g 1.00'))).toBe(true)
	})

	it('has nothing to label when the user drew no relations', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 900, 400)

		expect(badges()).toEqual([])
	})

	/** The reported bug, as an assertion: an arrow must be inside the exported box. */
	it('sizes the export to hold the arrow, not just the notes', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 900, 0)
		createRelationArrow('a', 'b')

		const canvas = grounded()
		const geometry = getRelationGeometry(editor, canvas.relations)
		const projection = groundingProjection(Object.values(canvas.nodes), GROUNDING_PADDING, geometry)

		expect(geometry).toHaveLength(1)
		for (const arrow of geometry) {
			expect(arrow.bounds.minX).toBeGreaterThanOrEqual(projection.minX)
			expect(arrow.bounds.minY).toBeGreaterThanOrEqual(projection.minY)
			expect(arrow.bounds.maxX).toBeLessThanOrEqual(projection.minX + projection.width)
			expect(arrow.bounds.maxY).toBeLessThanOrEqual(projection.minY + projection.height)
		}
	})

	/** Every arrow gets an entry, so the picture is joinable to the JSON. */
	it('indexes each relation in grounding.relations', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 900, 400)
		createRelationArrow('a', 'b', 0.6)

		const { grounding, relations } = grounded()
		const [only] = Object.values(relations)

		expect(Object.keys(grounding.relations)).toEqual(['R1'])
		expect(grounding.relations.R1.relationId).toBe(only.id)

		// And the region it names is inside the image it is relative to.
		const [x1, y1, x2, y2] = grounding.relations.R1.bbox
		expect(x1).toBeGreaterThanOrEqual(0)
		expect(y1).toBeGreaterThanOrEqual(0)
		expect(x2).toBeLessThanOrEqual(grounding.image.width)
		expect(y2).toBeLessThanOrEqual(grounding.image.height)
	})
})
