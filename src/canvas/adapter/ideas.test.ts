/**
 * @vitest-environment jsdom
 *
 * Turning reflected ideas into ghosts, and ghosts into agent-stamped notes.
 *
 * `planIdeaNotes` places the model's proposed texts in open space beside the board;
 * `createAgentNotes` commits chosen ghosts as real post-its marked as the agent's, in one undo
 * step. Both run against a live editor, which is where provenance and positioning actually land.
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
import { createPostItNode, type CanvasNode } from '@/domain'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { createAgentNotes, planIdeaNotes } from '@/canvas/adapter/ideas'
import { createAgentRelations } from '@/canvas/adapter/relations'

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

function agentNodes(): CanvasNode[] {
	return Object.values(getCanvasDocument(editor).nodes).filter(
		(node) => node.metadata.createdBy === 'agent'
	)
}

describe('planIdeaNotes', () => {
	it('places one ghost per proposal, to the right of the board', () => {
		createPostIt('a', 0, 0)

		const ghosts = planIdeaNotes(editor, [
			{ text: 'time to first value', kind: 'idea' },
			{ text: 'what makes teams stick?', kind: 'question' },
		])

		expect(ghosts).toHaveLength(2)
		expect(ghosts.map((g) => g.text)).toEqual(['time to first value', 'what makes teams stick?'])
		expect(ghosts.map((g) => g.kind)).toEqual(['idea', 'question'])
		for (const ghost of ghosts) expect(ghost.x).toBeGreaterThanOrEqual(240)
		// Ids are unique so the overlay and per-idea controls can key on them.
		expect(new Set(ghosts.map((g) => g.id)).size).toBe(2)
	})
})

describe('createAgentNotes', () => {
	it('creates a post-it per note, stamped as the agent, at its position', () => {
		const made = createAgentNotes(editor, [
			{ text: 'first value metric', x: 600, y: 0 },
			{ text: 'onboarding checklist', x: 600, y: 200 },
		])

		expect(made).toHaveLength(2)
		const agents = agentNodes()
		expect(agents).toHaveLength(2)
		expect(agents.every((n) => n.metadata.createdBy === 'agent')).toBe(true)
		expect(agents.map((n) => n.content.text).sort()).toEqual([
			'first value metric',
			'onboarding checklist',
		])
	})

	it('commits as a single undo step', () => {
		createAgentNotes(editor, [
			{ text: 'a', x: 600, y: 0 },
			{ text: 'b', x: 600, y: 200 },
		])
		expect(agentNodes()).toHaveLength(2)

		editor.undo()

		expect(agentNodes()).toHaveLength(0)
	})
})

describe('createAgentRelations', () => {
	it('draws an agent-stamped arrow between two notes, in one undo step', () => {
		createPostIt('a', 0, 0)
		createPostIt('b', 600, 0)
		const nodes = getCanvasDocument(editor).nodes

		const made = createAgentRelations(editor, [{ from: 'a', to: 'b', label: 'leads to' }], nodes)
		expect(made).toBe(1)

		const relations = Object.values(getCanvasDocument(editor).relations)
		expect(relations).toHaveLength(1)
		expect(relations[0]).toMatchObject({ from: 'a', to: 'b', type: 'leads to' })

		const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')
		expect(arrow?.meta?.createdBy).toBe('agent')

		editor.undo()
		expect(Object.values(getCanvasDocument(editor).relations)).toHaveLength(0)
	})

	it('skips a relation whose endpoint is missing or a self-link', () => {
		createPostIt('a', 0, 0)
		const nodes = getCanvasDocument(editor).nodes

		expect(
			createAgentRelations(
				editor,
				[
					{ from: 'a', to: 'gone' },
					{ from: 'a', to: 'a' },
				],
				nodes
			)
		).toBe(0)
	})
})
