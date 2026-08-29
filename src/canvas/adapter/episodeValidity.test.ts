// @vitest-environment jsdom
/**
 * The reading half of the staleness check, against a real editor.
 *
 * The judging is pure and tested as arithmetic in `thoughtQueue.test.ts`. What has to be
 * proved here is the seam: that what the adapter reads off the live canvas is in the same
 * terms the episode was recorded in. One of those terms is a trap — a `node_moved` carries the
 * *rounded centre* of a node, not its `spatial.x/y`, so a reader that returned the top-left
 * would produce a comparison between two coordinate systems and mis-drop remarks quietly.
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
	buildEpisodeSummary,
	createPostItNode,
	nodeCenter,
	roundPoint,
	type SpatialEvent,
} from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { readEpisodeValidity } from '@/canvas/adapter/episodeValidity'
import { isStillTrue, pairKey } from '@/companion/thoughtQueue'

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

function createPostIt(id: string, x: number, y: number, radius?: number) {
	const node = createPostItNode({ id, x, y, text: id, ...(radius === undefined ? {} : { radius }) })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })
}

/** Where the diff would say this node is — the frame a `node_moved` event speaks in. */
function centerOf(id: string) {
	return roundPoint(nodeCenter(getCanvasDocument(editor).nodes[id]))
}

const read = (summary: Parameters<typeof readEpisodeValidity>[1]) =>
	readEpisodeValidity(getCanvasDocument(editor), summary)

describe('readEpisodeValidity', () => {
	it('reports a node in the same frame the move that named it was recorded in', () => {
		createPostIt('a', 0, 0)
		const summary = buildEpisodeSummary([
			{ type: 'node_moved', nodeId: 'a', previous: { x: 0, y: 0 }, current: centerOf('a') },
		])

		expect(read(summary).centers.a).toEqual(centerOf('a'))
	})

	it('leaves out a node that no longer exists', () => {
		createPostIt('a', 0, 0)
		const summary = buildEpisodeSummary([{ type: 'node_created', nodeId: 'b' }])

		expect(read(summary).centers).toEqual({})
	})

	it('reads only the pairs the episode reported, not the whole board', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 100, 0)
		createPostIt('c', 4000, 0)
		const summary = buildEpisodeSummary([
			{
				type: 'influence_changed',
				source: 'a',
				target: 'b',
				previous: { influence: 0.04 },
				current: { influence: 0.58 },
			},
		])

		// The board holds every directed pair; carrying all of them into a judgement about two
		// notes would be quadratic and beside the point.
		expect(Object.keys(read(summary).influence)).toEqual([pairKey('a', 'b')])
	})

	it("reads a node's contextual field, and says nothing when it has none", () => {
		createPostIt('a', 0, 0, 300)
		createPostIt('b', 100, 0)
		const summary = buildEpisodeSummary([
			{ type: 'contextual_field_changed', nodeId: 'a', previous: 200, current: 300 },
			{ type: 'contextual_field_changed', nodeId: 'b', current: 0 },
		])

		const validity = read(summary)
		expect(validity.radius.a).toBe(300)
		expect('b' in validity.radius).toBe(false)
	})
})

describe('readEpisodeValidity — judged', () => {
	/** The move as the diff would have reported it, from `from` to wherever the node is now. */
	const movedTo = (id: string, from: { x: number; y: number }): SpatialEvent => ({
		type: 'node_moved',
		nodeId: id,
		previous: from,
		current: centerOf(id),
	})

	it('bears out a move the note has stayed put after', () => {
		createPostIt('a', 0, 0)
		const origin = centerOf('a')
		editor.updateShape({
			id: nodeToShape(createPostItNode({ id: 'a', x: 900, y: 0 })).id,
			type: 'post-it',
			x: 900,
			y: 0,
		})
		const summary = buildEpisodeSummary([movedTo('a', origin)])

		expect(isStillTrue(summary, read(summary))).toBe(true)
	})

	it('contradicts a move the note has been dragged back from', () => {
		createPostIt('a', 0, 0)
		const origin = centerOf('a')
		const shapeId = nodeToShape(createPostItNode({ id: 'a', x: 0, y: 0 })).id
		editor.updateShape({ id: shapeId, type: 'post-it', x: 900, y: 0 })
		const summary = buildEpisodeSummary([movedTo('a', origin)])
		// Back where it started, after the episode said it had gone.
		editor.updateShape({ id: shapeId, type: 'post-it', x: 0, y: 0 })

		expect(isStillTrue(summary, read(summary))).toBe(false)
	})

	it('contradicts an episode whose every idea has been deleted', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 100, 0)
		const summary = buildEpisodeSummary([
			{
				type: 'influence_changed',
				source: 'a',
				target: 'b',
				previous: { influence: 0.04 },
				current: { influence: 0.58 },
			},
		])
		editor.deleteShapes(editor.getCurrentPageShapes().map((shape) => shape.id))

		expect(isStillTrue(summary, read(summary))).toBe(false)
	})
})
