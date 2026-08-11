/**
 * @vitest-environment jsdom
 *
 * Relations against a real editor, with real arrows and real bindings.
 *
 * This is where the feature lives. The pure suite can check a label and a meta
 * flag, but every interesting rule — both ends bound, bound to a *Node*, the
 * direction, what happens when an endpoint is deleted — is a fact about tldraw's
 * binding store, so guessing at it in a fake would prove nothing.
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
	createRelations,
	selectedRelationArrowIds,
	setRelationGravity,
} from '@/canvas/adapter/relations'
import { RELATION_TOOL_ID, RelationTool } from '@/canvas/shapes/RelationTool'

const shapeUtils = [...defaultShapeUtils, PostItShapeUtil]

let editor: Editor

beforeEach(() => {
	editor = new Editor({
		store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		// `defaultShapeTools` too, so the arrow tool is present: "tagged by the
		// Relation tool but not by the arrow tool" is the discrimination that matters,
		// and it can only be tested with both registered — as the app has them.
		tools: [...defaultTools, ...defaultShapeTools, RelationTool],
		getContainer: () => document.createElement('div'),
	})

	registerNodeMetadata(editor)
})

function createPostIt(id: string, x = 0, y = 0) {
	const node = createPostItNode({ id, x, y })
	editor.createShape({ ...nodeToShape(node), parentId: editor.getCurrentPageId() })

	return nodeIdToShapeId(id)
}

/**
 * An arrow plus its bindings, the way the tool leaves things. `isRelation`
 * mirrors what `getInitialMetaForShape` stamps, so an untagged arrow here is
 * exactly what the plain arrow tool produces.
 */
function createArrow({
	from,
	to,
	label,
	gravity,
	isRelation = true,
}: {
	from?: TLShapeId
	to?: TLShapeId
	label?: string
	gravity?: number
	isRelation?: boolean
}) {
	const id = createShapeId()

	editor.createShape({
		id,
		type: ARROW_SHAPE_TYPE,
		parentId: editor.getCurrentPageId(),
		// The tool stamps the flag and nothing else, so `gravity` is omitted unless a
		// test is about one — which keeps "a freshly drawn arrow carries no stored
		// gravity" the default case here, as it is in the app.
		meta: isRelation
			? {
					[RELATION_META_KEY]: true,
					...(gravity === undefined ? {} : { [RELATION_GRAVITY_META_KEY]: gravity }),
				}
			: {},
		...(label === undefined ? {} : { props: { richText: toRichText(label) } }),
	})

	editor.createBindings(
		[from ? binding(id, from, 'start') : undefined, to ? binding(id, to, 'end') : undefined].filter(
			(value) => value !== undefined
		)
	)

	return id
}

function binding(arrowId: TLShapeId, toId: TLShapeId, terminal: 'start' | 'end') {
	return {
		type: ARROW_SHAPE_TYPE,
		fromId: arrowId,
		toId,
		props: {
			terminal,
			normalizedAnchor: { x: 0.5, y: 0.5 },
			isExact: false,
			isPrecise: false,
		},
	} as const
}

function toRichText(text: string) {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function relations() {
	return getCanvasDocument(editor).relations
}

function only() {
	const all = Object.values(relations())
	expect(all, 'expected exactly one relation').toHaveLength(1)

	return all[0]
}

describe('relations projected from arrows', () => {
	it('projects an arrow bound to two post-its', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		expect(only()).toMatchObject({ from: 'a', to: 'b' })
	})

	it('takes its id from the arrow, without the shape prefix', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b })

		expect(only().id).toBe(arrow.slice('shape:'.length))
		expect(JSON.stringify(relations())).not.toContain('shape:')
	})

	/** Direction is the arrow's direction: `start` is `from`, `end` is `to`. */
	it('reverses when the terminals are swapped', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: b, to: a })

		expect(only()).toMatchObject({ from: 'b', to: 'a' })
	})

	it('takes its type from the arrow’s label', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, label: 'causes' })

		expect(only().type).toBe('causes')
	})

	/** Absent, not empty: connected without a stated reason is its own claim. */
	it('has no type key at all when the arrow is unlabelled', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		expect(only()).not.toHaveProperty('type')
		expect(JSON.stringify(relations())).not.toContain('type')
	})

	it('ignores a plain arrow between the same two post-its', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, isRelation: false })

		expect(relations()).toEqual({})
	})

	it('ignores an arrow with one end loose', () => {
		const a = createPostIt('a', 0, 0)
		createPostIt('b', 600, 0)
		createArrow({ from: a })

		expect(relations()).toEqual({})
	})

	it('ignores an arrow bound to something that is not a node', () => {
		const a = createPostIt('a', 0, 0)

		const geo = createShapeId()
		editor.createShape({ id: geo, type: 'geo', x: 600, y: 0, parentId: editor.getCurrentPageId() })
		createArrow({ from: a, to: geo })

		expect(relations()).toEqual({})
	})

	it('ignores an arrow whose ends are the same node', () => {
		const a = createPostIt('a', 0, 0)
		createArrow({ from: a, to: a })

		expect(relations()).toEqual({})
	})

	it('projects several relations at once', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const c = createPostIt('c', 0, 600)
		createArrow({ from: a, to: b, label: 'causes' })
		createArrow({ from: b, to: c })

		const all = Object.values(relations())
		expect(all).toHaveLength(2)
		expect(all.map((relation) => `${relation.from}→${relation.to}`).sort()).toEqual(['a→b', 'b→c'])
	})
})

describe('relations as the canvas changes', () => {
	it('survives moving a node — the claim is unchanged by the layout', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, label: 'causes' })

		const before = only()
		editor.updateShapes([{ id: a, type: 'post-it', x: 2000, y: 1500 }])

		expect(only()).toEqual(before)
	})

	/**
	 * tldraw drops the binding and keeps the line, so the arrow stops describing
	 * two nodes and stops being a relation. The dangling line staying visible is a
	 * known limitation.
	 */
	it('drops when an endpoint node is deleted', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		editor.deleteShapes([b])

		expect(relations()).toEqual({})
	})

	it('drops when the arrow itself is deleted', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b })

		editor.deleteShapes([arrow])

		expect(relations()).toEqual({})
	})
})

describe('gravity', () => {
	/** Drawing the arrow is the claim; nothing has to be typed for it to be full strength. */
	it('is the full-strength default for a freshly drawn relation', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		expect(only().gravity).toBe(1)
	})

	it('is whatever the arrow stores', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, gravity: 0.35 })

		expect(only().gravity).toBe(0.35)
	})

	it('survives moving a node — distance has no say in it', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, gravity: 0.4 })

		editor.updateShapes([{ id: a, type: 'post-it', x: 9000, y: 9000 }])

		expect(only().gravity).toBe(0.4)
	})

	it('is only ever on the direction the user drew', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: b, to: a, gravity: 0.5 })

		const all = Object.values(relations())
		expect(all).toHaveLength(1)
		expect(all[0]).toMatchObject({ from: 'b', to: 'a', gravity: 0.5 })
	})
})

describe('setRelationGravity', () => {
	it('writes the gravity and reports what it changed', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b })

		expect(setRelationGravity(editor, [arrow], 0.25)).toBe(1)
		expect(only().gravity).toBe(0.25)
	})

	/** The whole reason the patch carries one key: un-tagging would make it decoration. */
	it('leaves the arrow a relation', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b, label: 'causes' })

		setRelationGravity(editor, [arrow], 0.25)

		expect(editor.getShape(arrow)?.meta[RELATION_META_KEY]).toBe(true)
		expect(only()).toMatchObject({ from: 'a', to: 'b', type: 'causes', gravity: 0.25 })
	})

	it('clamps what it is given', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b })

		setRelationGravity(editor, [arrow], 12)

		expect(only().gravity).toBe(1)
	})

	it('is one undo step', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b, gravity: 1 })

		setRelationGravity(editor, [arrow], 0.1)
		expect(only().gravity).toBe(0.1)

		editor.undo()

		expect(only().gravity).toBe(1)
	})

	it('refuses a plain arrow', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const decoration = createArrow({ from: a, to: b, isRelation: false })

		expect(setRelationGravity(editor, [decoration], 0.5)).toBe(0)
		expect(editor.getShape(decoration)?.meta[RELATION_GRAVITY_META_KEY]).toBeUndefined()
	})

	it('refuses a post-it, and a shape that is gone', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b })
		editor.deleteShapes([arrow])

		expect(setRelationGravity(editor, [a, arrow], 0.5)).toBe(0)
	})

	it('sets several at once', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const c = createPostIt('c', 0, 600)
		const first = createArrow({ from: a, to: b })
		const second = createArrow({ from: b, to: c })

		expect(setRelationGravity(editor, [first, second], 0.5)).toBe(2)
		expect(Object.values(relations()).map((relation) => relation.gravity)).toEqual([0.5, 0.5])
	})
})

describe('selectedRelationArrowIds', () => {
	it('is the relation arrows in the selection, and nothing else', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const arrow = createArrow({ from: a, to: b })
		const decoration = createArrow({ from: a, to: b, isRelation: false })

		editor.select(a, arrow, decoration)

		expect(selectedRelationArrowIds(editor)).toEqual([arrow])
	})

	it('is empty with nothing selected', () => {
		createPostIt('a', 0, 0)
		editor.selectNone()

		expect(selectedRelationArrowIds(editor)).toEqual([])
	})
})

describe('relations and spatialContext stay independent', () => {
	it('a relation creates no influence', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 4000, 0)
		createArrow({ from: a, to: b, label: 'causes' })

		const document = getCanvasDocument(editor)

		expect(Object.keys(document.relations)).toHaveLength(1)
		expect(document.spatialContext.influences.every((row) => row.influence === 0)).toBe(true)
	})

	/**
	 * The case the whole separation exists for: far apart, and explicitly related
	 * anyway. Both numbers are reported, neither is corrected by the other, and no
	 * third number combining them is produced.
	 */
	it('reports a strong relation between two barely-influencing nodes', () => {
		const node = (id: string, x: number) =>
			editor.createShape({
				...nodeToShape(createPostItNode({ id, x, y: 0, radius: 500 })),
				parentId: editor.getCurrentPageId(),
			})
		node('a', 0)
		node('b', 484)

		const arrow = createArrow({ from: nodeIdToShapeId('b'), to: nodeIdToShapeId('a') })
		setRelationGravity(editor, [arrow], 1)

		const document = getCanvasDocument(editor)
		const spatial = document.spatialContext.influences.find(
			(row) => row.source === 'b' && row.target === 'a'
		)

		expect(spatial?.influence).toBeLessThan(0.1)
		expect(spatial?.influence).toBeGreaterThan(0)
		expect(only()).toMatchObject({ from: 'b', to: 'a', gravity: 1 })

		// No blended value anywhere: the reader gets both signals, unmixed.
		expect(JSON.stringify(document)).not.toContain('effectiveInfluence')
	})

	/** Spatial influence is symmetric in existence; an explicit relation is not. */
	it('does not invent the reverse relation', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: b, to: a })

		const document = getCanvasDocument(editor)

		expect(Object.values(document.relations)).toHaveLength(1)
		expect(
			document.spatialContext.influences.some((row) => row.source === 'a' && row.target === 'b')
		).toBe(true)
	})

	it('proximity creates no relation', () => {
		const node = (id: string, x: number) =>
			editor.createShape({
				...nodeToShape(createPostItNode({ id, x, y: 0, radius: 900 })),
				parentId: editor.getCurrentPageId(),
			})
		node('a', 0)
		node('b', 40)

		const document = getCanvasDocument(editor)

		expect(document.spatialContext.influences[0].influence).toBeGreaterThan(0.9)
		expect(document.relations).toEqual({})
	})
})

describe('createRelations — rebuilding from canonical JSON', () => {
	/** Clears the page the way the Inspector's import does, then rebuilds. */
	function reimport(document: ReturnType<typeof getCanvasDocument>) {
		editor.deleteShapes(editor.getCurrentPageShapes().map((shape) => shape.id))

		const pageId = editor.getCurrentPageId()
		editor.createShapes(
			Object.values(document.nodes).map((node) => ({ ...nodeToShape(node), parentId: pageId }))
		)

		return createRelations(editor, document.relations, document.nodes)
	}

	it('round-trips a relation exactly', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, label: 'causes' })

		const before = getCanvasDocument(editor)
		expect(reimport(before)).toBe(1)

		expect(relations()).toEqual(before.relations)
	})

	it('round-trips gravity', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, gravity: 0.35 })

		reimport(getCanvasDocument(editor))

		expect(only().gravity).toBe(0.35)
	})

	/**
	 * A document is typed by assertion only, so `createRelations` is the boundary
	 * that has to hold: a junk gravity becomes the default rather than reaching the
	 * store, and a `gravity` of `0` is honoured rather than being read as absent.
	 */
	it('sanitises the gravity it is given', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		const document = getCanvasDocument(editor)
		const id = Object.keys(document.relations)[0]

		expect(
			reimport({
				...document,
				relations: {
					[id]: { ...document.relations[id], gravity: 9 as number },
				},
			})
		).toBe(1)
		expect(only().gravity).toBe(1)
	})

	it('honours a gravity of zero across the round trip', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b, gravity: 0 })

		reimport(getCanvasDocument(editor))

		expect(only().gravity).toBe(0)
	})

	it('round-trips an unlabelled relation without inventing a type', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		reimport(getCanvasDocument(editor))

		expect(only()).not.toHaveProperty('type')
	})

	it('keeps direction across the round trip', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: b, to: a })

		reimport(getCanvasDocument(editor))

		expect(only()).toMatchObject({ from: 'b', to: 'a' })
	})

	it('round-trips several relations', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		const c = createPostIt('c', 0, 600)
		createArrow({ from: a, to: b, label: 'causes' })
		createArrow({ from: b, to: c, label: 'supports' })

		const before = getCanvasDocument(editor)
		reimport(before)

		expect(relations()).toEqual(before.relations)
	})

	/**
	 * A relation naming a node that isn't in the document can't be drawn without
	 * inventing an endpoint, so it is skipped rather than left half-bound.
	 */
	it('skips a relation whose endpoint is missing', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		const document = getCanvasDocument(editor)
		const orphaned = {
			...document,
			relations: {
				...document.relations,
				ghost: { id: 'ghost', from: 'a', to: 'nobody', gravity: 1 },
			},
		}

		expect(reimport(orphaned)).toBe(1)
		expect(Object.keys(relations())).toHaveLength(1)
	})

	it('creates arrows the projection recognises as relations', () => {
		const a = createPostIt('a', 0, 0)
		const b = createPostIt('b', 600, 0)
		createArrow({ from: a, to: b })

		reimport(getCanvasDocument(editor))

		const arrows = editor.getCurrentPageShapes().filter((shape) => shape.type === ARROW_SHAPE_TYPE)
		expect(arrows).toHaveLength(1)
		expect(arrows[0].meta[RELATION_META_KEY]).toBe(true)
	})
})

describe('the Relation tool', () => {
	/**
	 * The one thing the tool exists to do. `getInitialMetaForShape` reads
	 * `getCurrentToolId()` to decide whether an arrow is a claim, so this pins that
	 * it reports the root tool id while the tool's child state is creating a shape.
	 */
	it('stamps arrows it creates, and the arrow tool does not', () => {
		editor.setCurrentTool(RELATION_TOOL_ID)
		const tagged = editor.getInitialMetaForShape({ type: ARROW_SHAPE_TYPE } as never)

		editor.setCurrentTool('arrow')
		const untagged = editor.getInitialMetaForShape({ type: ARROW_SHAPE_TYPE } as never)

		expect(tagged).toEqual({ [RELATION_META_KEY]: true })
		expect(untagged).toEqual({})
	})

	it('is registered under its own id and still draws arrows', () => {
		editor.setCurrentTool(RELATION_TOOL_ID)

		expect(editor.getCurrentToolId()).toBe(RELATION_TOOL_ID)
	})
})
