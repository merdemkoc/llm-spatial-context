/**
 * @vitest-environment jsdom
 *
 * The event stream, wired to a real editor.
 *
 * `deriveEvents` is proven pure elsewhere; what this suite proves is the wiring — that
 * a real drag, a real arrow and a real deletion each reach the stream as the events the
 * spec's demonstration scenario (§8) expects, including the divergence state where a
 * connected node is dragged out of range and the relation survives.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
	createShapeId,
	createTLStore,
	defaultBindingUtils,
	defaultShapeTools,
	defaultShapeUtils,
	defaultTools,
	Editor,
	type TLShapeId,
} from 'tldraw'
import {
	createPostItNode,
	createEventStream,
	type SpatialEvent,
	type SpatialEventStream,
} from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { ARROW_SHAPE_TYPE, RELATION_META_KEY } from '@/canvas/adapter/relations'
import { registerSpatialEvents } from '@/canvas/adapter/spatialEvents'

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor
let stream: SpatialEventStream
let dispose: () => void

beforeEach(() => {
	editor = new Editor({
		store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [...defaultTools, ...defaultShapeTools],
		getContainer: () => document.createElement('div'),
	})
	registerNodeMetadata(editor)

	stream = createEventStream()
	// Registered before any nodes exist, so every creation below is observed.
	dispose = registerSpatialEvents(editor, stream)
})

function createPostIt(id: string, x = 0, y = 0, radius?: number) {
	const node = createPostItNode({ id, x, y, radius })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })

	return nodeIdToShapeId(id)
}

function move(id: TLShapeId, x: number, y = 0) {
	editor.updateShapes([{ id, type: 'post-it', x, y }])
}

/** A relation arrow bound to two post-its, the way the Relation tool leaves things. */
function createRelationArrow(from: TLShapeId, to: TLShapeId) {
	const id = createShapeId()
	editor.createShape({
		id,
		type: ARROW_SHAPE_TYPE,
		parentId: editor.getCurrentPageId(),
		meta: { [RELATION_META_KEY]: true },
	})
	editor.createBindings([
		{ type: ARROW_SHAPE_TYPE, fromId: id, toId: from, props: terminal('start') },
		{ type: ARROW_SHAPE_TYPE, fromId: id, toId: to, props: terminal('end') },
	])
	return id
}

function terminal(terminal: 'start' | 'end') {
	return {
		terminal,
		normalizedAnchor: { x: 0.5, y: 0.5 },
		isExact: false,
		isPrecise: false,
	} as const
}

function ofType<T extends SpatialEvent['type']>(
	type: T
): Array<Extract<SpatialEvent, { type: T }>> {
	return stream
		.getRecent()
		.filter((event): event is Extract<SpatialEvent, { type: T }> => event.type === type)
}

describe('registerSpatialEvents — live wiring', () => {
	it('emits node_created when a node is added', () => {
		createPostIt('a', 0, 0, 500)

		expect(ofType('node_created').map((event) => event.nodeId)).toContain('a')
	})

	it('emits field_entered when a node is dragged into another node’s field', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 600, 0) // 600 away, outside a's 500 field

		stream.clear()
		move(nodeIdToShapeId('b'), 300) // now 300 away → influence 0.4

		const entered = ofType('field_entered')
		expect(entered).toHaveLength(1)
		expect(entered[0]).toMatchObject({ source: 'a', target: 'b' })
	})

	it('emits field_exited when a node is dragged out of range', () => {
		createPostIt('a', 0, 0, 500)
		createPostIt('b', 100, 0) // inside the field

		stream.clear()
		move(nodeIdToShapeId('b'), 900) // out of range

		expect(ofType('field_exited')).toHaveLength(1)
	})

	it('emits relation_created when a relation arrow is drawn', () => {
		const a = createPostIt('a', 0, 0, 500)
		const b = createPostIt('b', 300, 0)

		stream.clear()
		createRelationArrow(a, b)

		expect(ofType('relation_created')).toMatchObject([{ source: 'a', target: 'b' }])
	})

	it('stops emitting after dispose', () => {
		dispose()
		createPostIt('a', 0, 0, 500)

		expect(stream.getRecent()).toEqual([])
	})

	/**
	 * A known gap, pinned so it stays a decision rather than a surprise. `diffCanvas`
	 * compares geometry, fields and relations — not `content.text` — so editing a note
	 * bumps its `updatedAt` and changes nothing the stream can see. Nothing spatial
	 * moved, and the event vocabulary is deliberately spatial.
	 */
	it('emits nothing when only a note’s text changes', () => {
		const a = createPostIt('a', 0, 0, 500)
		createPostIt('b', 300, 0)
		stream.clear()

		editor.updateShapes([
			{
				id: a,
				type: 'post-it',
				props: {
					richText: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'edited' }] }],
					},
				},
			},
		])

		expect(stream.getRecent()).toEqual([])
	})

	/**
	 * An undo is a document change like any other, so it is reported as one: the stream
	 * appends the events describing the reversal rather than retracting the events it
	 * already delivered. A subscriber that has acted on an event is never told to
	 * un-act — it is told what the canvas did next, which is the only thing an
	 * append-only stream can honestly say.
	 */
	it('reports an undo as the events that reverse it, not as a retraction', () => {
		createPostIt('a', 0, 0, 500)
		const b = createPostIt('b', 600, 0)
		editor.markHistoryStoppingPoint('move')
		move(b, 300) // into the field
		stream.clear()

		editor.undo()

		expect(stream.getRecent().map((event) => event.type)).toEqual(['node_moved', 'field_exited'])
	})
})

describe('registerSpatialEvents — the divergence scenario (§8)', () => {
	it('keeps the relation and reports the field exit when a connected node is dragged far away', () => {
		const a = createPostIt('a', 0, 0, 500)
		const b = createPostIt('b', 100, 0) // close: influence 0.8
		createRelationArrow(a, b)

		stream.clear()
		move(b, 900) // drag far: influence collapses, relation untouched

		// The stream reports the field exit...
		expect(ofType('field_exited')).toHaveLength(1)
		// ...and never a relation deletion: proximity and intent are independent.
		expect(ofType('relation_deleted')).toEqual([])

		// The final document proves the divergence: distance high, influence gone, relation intact.
		const document = getCanvasDocument(editor)
		const pair = document.spatialContext.influences.find(
			(row) => row.source === 'a' && row.target === 'b'
		)
		expect(pair?.influence).toBe(0)
		expect(pair?.distance).toBeGreaterThan(500)
		expect(Object.values(document.relations)).toMatchObject([{ from: 'a', to: 'b' }])
	})
})
