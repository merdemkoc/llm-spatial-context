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
import { createTLStore, defaultBindingUtils, defaultShapeUtils, defaultTools, Editor } from 'tldraw'
import { createPostItNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { GROUNDING_PADDING } from '@/canvas/grounding/annotationLayer'
import { buildGrounding, groundedDocument } from '@/canvas/grounding/grounding'
import { groundingProjection } from '@/canvas/grounding/projection'
import { assignVisualIds } from '@/canvas/grounding/visualId'

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

/** The same sequence `buildGroundedScreenshot` runs, minus the rasterising. */
function grounded() {
	const canvas = getCanvasDocument(editor)
	const nodes = Object.values(canvas.nodes)

	const labelled = assignVisualIds(nodes)
	const projection = groundingProjection(nodes, GROUNDING_PADDING)

	return groundedDocument(
		canvas,
		buildGrounding(labelled, projection, {
			width: projection.width * EXPORT_SCALE,
			height: projection.height * EXPORT_SCALE,
		})
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
