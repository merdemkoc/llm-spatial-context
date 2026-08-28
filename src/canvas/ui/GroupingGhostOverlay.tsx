/**
 * A proposed grouping, drawn.
 *
 * When the companion proposes pulling some ideas together, this previews the move: each
 * member highlighted where it is now, a faint dashed ghost where it would land, and a thin
 * line between the two. Accepting commits the move; dismissing clears the proposal — this
 * only ever shows it.
 *
 * A viewing aid, like `ContextualFieldOverlay`, and registered the same way (as part of the
 * `OnTheCanvas` composite): it reads the atom and the canonical model, writes nothing, and
 * renders behind the shapes and outside the export path — so a ghost never reaches a grounded
 * screenshot and never covers a note's text or a click. Uses the companion's field ink, so
 * the proposal reads in the same voice as the thinking hint, distinct from selection blue.
 */
import { useEditor, useValue } from 'tldraw'
import { nodeCenter, type CanvasNode } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import { groupingSuggestion } from '@/companion/companionState'
import { FIELD_INK, fieldTint } from '@/canvas/ui/theme'

export function GroupingGhostOverlay() {
	const editor = useEditor()
	const suggestion = useValue(groupingSuggestion)
	const canvas = useCanvasDocument()
	const zoom = useValue('zoom level', () => editor.getZoomLevel(), [editor])

	if (!suggestion) return null

	// Resolve members against the live canvas: a note deleted since the proposal has no box to
	// draw, so it is dropped rather than guessed at.
	const members = suggestion.members
		.map((id) => {
			const node = canvas.nodes[id]
			const target = suggestion.targets.find((entry) => entry.id === id)
			return node && target ? { node, target } : null
		})
		.filter((member): member is { node: CanvasNode; target: { id: string; x: number; y: number } } => member !== null)

	if (members.length === 0) return null

	return (
		<>
			{/* Motion hints in one page-coordinate SVG. Zero-size with overflow visible, so the
			    lines are drawn in canvas space without a viewport to clip them. */}
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
				{members.map(({ node, target }) => {
					const from = nodeCenter(node)
					const to = nodeCenter({ ...node, spatial: { ...node.spatial, x: target.x, y: target.y } })
					return (
						<line
							key={node.id}
							x1={from.x}
							y1={from.y}
							x2={to.x}
							y2={to.y}
							stroke={FIELD_INK}
							strokeWidth={1.5 / zoom}
							strokeDasharray={`${6 / zoom} ${4 / zoom}`}
						/>
					)
				})}
			</svg>

			{/* Where each member is now: a solid ring, drawn first. */}
			{members.map(({ node }) => (
				<GhostBox key={`member-${node.id}`} node={node} x={node.spatial.x} y={node.spatial.y} zoom={zoom} kind="member" />
			))}

			{/* Where each member would land: a faint dashed box, drawn last so it reads as the target. */}
			{members.map(({ node, target }) => (
				<GhostBox key={`ghost-${node.id}`} node={node} x={target.x} y={target.y} zoom={zoom} kind="ghost" />
			))}
		</>
	)
}

function GhostBox({
	node,
	x,
	y,
	zoom,
	kind,
}: {
	node: CanvasNode
	x: number
	y: number
	zoom: number
	kind: 'member' | 'ghost'
}) {
	const { width, height, rotation } = node.spatial
	const isGhost = kind === 'ghost'

	return (
		<div
			{...(isGhost ? { 'data-grouping-ghost': node.id } : { 'data-grouping-member': node.id })}
			aria-hidden="true"
			style={{
				position: 'absolute',
				left: x,
				top: y,
				width,
				height,
				// Rotation is applied about the top-left corner, matching the model and the way
				// `nodeCenter` reads it — so the ghost sits exactly where the note would.
				transform: `rotate(${rotation}rad)`,
				transformOrigin: 'top left',
				// Divided by the zoom to survive the camera layer's CSS transform, like the field
				// circles: an untouched border would thicken at high zoom and vanish at low.
				borderWidth: (isGhost ? 2 : 2.5) / zoom,
				borderStyle: isGhost ? 'dashed' : 'solid',
				borderColor: FIELD_INK,
				borderRadius: 4 / zoom,
				background: isGhost ? fieldTint(0.06) : 'transparent',
				// Never what a click lands on: the note underneath must stay reachable.
				pointerEvents: 'none',
			}}
		/>
	)
}
