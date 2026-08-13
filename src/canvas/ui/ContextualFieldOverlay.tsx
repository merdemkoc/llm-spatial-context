/**
 * The contextual field, drawn.
 *
 * `contextualField.radius` was the one piece of spatial state with no visual
 * form: you set it as a number and read its consequences as numbers, so "does
 * this note reach that one?" meant comparing a distance column against a radius
 * by hand. This draws the reach itself.
 *
 * A viewing aid and nothing more. It reads the canonical model and writes
 * nothing, adds nothing to the document, and infers nothing — no lines between
 * nodes, no distance labels, no shading where two fields overlap. Overlap is
 * visible because two translucent circles overlap, which is the entire intent.
 *
 * Registered as `components.OnTheCanvas`, which buys two things worth knowing:
 *
 *   - It renders inside `tl-html-layer`, the camera-transformed layer, so these
 *     are page coordinates and panning and zooming need no arithmetic here.
 *   - It renders *before* the shapes layer and is not part of the export path
 *     (`getSvgJsx` renders only `InnerShape`), so fields sit behind the notes and
 *     never reach a grounded screenshot. Requirement: the grounded PNG carries a
 *     bounding-box index and no influence rings.
 */
import { useEditor, useValue } from 'tldraw'
import { nodeCenter, type CanvasNode } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import { selectedPostItIds } from '@/canvas/adapter/contextualField'
import { shapeIdToNodeId } from '@/canvas/adapter/ids'
import { InfluenceBadges } from '@/canvas/ui/InfluenceBadges'
import { showContextualFields } from '@/canvas/ui/contextualFieldVisibility'
import { FIELD_INK, fieldTint } from '@/canvas/ui/theme'

/**
 * Indigo, and deliberately neither the grounding layer's hot pink nor tldraw's
 * selection blue. Three overlays that mean three different things shouldn't be
 * confusable at a glance. Defined once in `theme.ts`, since the influence badges
 * and the companion's thinking hint are the same voice speaking.
 */
const FIELD_FILL = fieldTint(0.06)

/**
 * Screen pixels, divided by the zoom to survive the layer's CSS transform.
 *
 * Only the width needs scaling: a dashed border's dash length is derived from its
 * thickness by the browser, so the dashes stay dashes for free.
 */
const BORDER_WIDTH = 1.5
const SELECTED_BORDER_WIDTH = 3

/** Selection reads as a solid, denser ring, so "which field is this?" is instant. */
const SELECTED_FILL = fieldTint(0.13)

const ID_SEPARATOR = ' '

export function ContextualFieldOverlay() {
	const editor = useEditor()
	const canvas = useCanvasDocument()

	const isShowing = useValue(showContextualFields)
	const zoom = useValue('zoom level', () => editor.getZoomLevel(), [editor])

	// Joined to a string rather than kept as an array: `useValue` compares by
	// identity, and a fresh array every recomputation would re-render on every
	// unrelated store change.
	const selectedKey = useValue(
		'selected post-its',
		() => selectedPostItIds(editor).map(shapeIdToNodeId).join(ID_SEPARATOR),
		[editor]
	)

	if (!isShowing) return null

	const selectedIds = selectedKey ? selectedKey.split(ID_SEPARATOR) : []
	const selected = new Set(selectedIds)

	// Selected fields last. Fields overlap by design, and a translucent circle
	// drawn afterwards would wash over the outline of the one being looked at.
	const nodes = Object.values(canvas.nodes).sort(
		(a, b) => Number(selected.has(a.id)) - Number(selected.has(b.id))
	)

	return (
		<>
			{nodes.map((node) => (
				<FieldCircle key={node.id} node={node} zoom={zoom} isSelected={selected.has(node.id)} />
			))}

			{/* Scores only for a single selection: `→` and `←` are relative to *the*
			    selected node, and with two there is no referent for either arrow.
			    Rendered after the circles so badges sit above them. */}
			{selectedIds.length === 1 && (
				<InfluenceBadges canvas={canvas} selectedId={selectedIds[0]} zoom={zoom} />
			)}
		</>
	)
}

function FieldCircle({
	node,
	zoom,
	isSelected,
}: {
	node: CanvasNode
	zoom: number
	isSelected: boolean
}) {
	const radius = node.contextualField?.radius

	// A radius of `0` or less is a real state — "this node's context reaches
	// nowhere" — and `calculateSpatialInfluence` already reads it that way. A
	// zero-size circle would be noise rather than information.
	if (radius === undefined || !Number.isFinite(radius) || radius <= 0) return null

	// Not `x + width / 2`: rotation is applied about the unrotated box's top-left
	// corner, so for any rotated node the naive midpoint has itself been rotated
	// away. Sharing `nodeCenter` with the influence maths is what keeps this
	// picture honest about the numbers beside it.
	const center = nodeCenter(node)

	return (
		<div
			data-contextual-field={node.id}
			data-selected={isSelected}
			aria-hidden="true"
			style={{
				position: 'absolute',
				left: center.x - radius,
				top: center.y - radius,
				width: radius * 2,
				height: radius * 2,
				borderRadius: '50%',
				borderWidth: (isSelected ? SELECTED_BORDER_WIDTH : BORDER_WIDTH) / zoom,
				// Solid for the selection, dashed otherwise: a difference in kind
				// rather than only in degree, so it survives being zoomed out until
				// every outline is a hairline.
				borderStyle: isSelected ? 'solid' : 'dashed',
				borderColor: FIELD_INK,
				background: isSelected ? SELECTED_FILL : FIELD_FILL,
				// The overlay must never be what a click lands on: it covers a large
				// area and sits above nothing the user is trying to hit.
				pointerEvents: 'none',
			}}
		/>
	)
}
