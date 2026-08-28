/**
 * The agent's proposed arrows, drawn as ghosts.
 *
 * A reflection can propose two kinds of link: an arrow between two existing notes, and a new-note
 * idea that should connect to an existing note. Both preview here as dashed, agent-tinted arrows;
 * accepting draws the real grey arrow. This only ever shows the proposal.
 *
 * Part of the `OnTheCanvas` composite: reads the atoms and the canonical model, writes nothing,
 * renders behind the shapes and out of the export path. One page-coordinate SVG holds every line.
 */
import { useEditor, useValue } from 'tldraw'
import { nodeCenter, POST_IT_DEFAULT_HEIGHT, POST_IT_DEFAULT_WIDTH, type Point } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import { ideaSuggestions, relationSuggestions } from '@/companion/companionState'
import { AGENT_INK } from '@/canvas/ui/theme'

interface GhostArrow {
	id: string
	from: Point
	to: Point
}

export function RelationGhostOverlay() {
	const editor = useEditor()
	const relations = useValue(relationSuggestions)
	const ideas = useValue(ideaSuggestions)
	const canvas = useCanvasDocument()
	const zoom = useValue('zoom level', () => editor.getZoomLevel(), [editor])

	const ghostArrows: GhostArrow[] = []
	// Existing → existing: both ends are real notes.
	for (const relation of relations) {
		const from = canvas.nodes[relation.from]
		const to = canvas.nodes[relation.to]
		if (from && to) ghostArrows.push({ id: `rel-${relation.id}`, from: nodeCenter(from), to: nodeCenter(to) })
	}
	// New note → existing: the start is the ghost idea's centre, the end an existing note.
	for (const idea of ideas) {
		if (!idea.connectTo) continue
		const to = canvas.nodes[idea.connectTo]
		if (!to) continue
		ghostArrows.push({
			id: `idea-${idea.id}`,
			from: { x: idea.x + POST_IT_DEFAULT_WIDTH / 2, y: idea.y + POST_IT_DEFAULT_HEIGHT / 2 },
			to: nodeCenter(to),
		})
	}

	if (ghostArrows.length === 0) return null

	const strokeWidth = 2 / zoom

	return (
		<svg
			aria-hidden="true"
			style={{
				position: 'absolute',
				left: 0,
				top: 0,
				width: 0,
				height: 0,
				overflow: 'visible',
				pointerEvents: 'none',
			}}
		>
			<defs>
				<marker
					id="agent-ghost-arrowhead"
					markerWidth="6"
					markerHeight="6"
					refX="5"
					refY="3"
					orient="auto"
					markerUnits="strokeWidth"
				>
					<path d="M0,0 L6,3 L0,6 z" fill={AGENT_INK} />
				</marker>
			</defs>
			{ghostArrows.map((arrow) => (
				<line
					key={arrow.id}
					data-ghost-arrow={arrow.id}
					x1={arrow.from.x}
					y1={arrow.from.y}
					x2={arrow.to.x}
					y2={arrow.to.y}
					stroke={AGENT_INK}
					strokeWidth={strokeWidth}
					strokeDasharray={`${6 / zoom} ${4 / zoom}`}
					markerEnd="url(#agent-ghost-arrowhead)"
				/>
			))}
		</svg>
	)
}
