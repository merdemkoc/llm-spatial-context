/**
 * The companion's spotlight.
 *
 * While the companion speaks, the notes its remark is about are highlighted — a soft region
 * enclosing them, and a ring on each. It reads the `companionFocus` atom (set for as long as an
 * utterance plays) and clears itself the moment the remark ends, so it reads as attention, not a
 * standing mark.
 *
 * A viewing aid like the other overlays, part of the `OnTheCanvas` composite: it reads the atom
 * and the canonical model, writes nothing, renders behind the shapes and outside the export
 * path. It wears its own amber ink, distinct from the field circles and the agent notes.
 */
import { useEditor, useValue } from 'tldraw'
import type { CanvasNode } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import { companionFocus } from '@/companion/companionState'
import { FOCUS_INK, focusTint } from '@/canvas/ui/theme'

/** Clearance from the notes: the region sits well outside them, the ring just outside each. */
const REGION_PAD = 24
const RING_PAD = 8

interface Bounds {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

/** Axis-aligned bounds of a node, accounting for its rotation. */
function nodeBounds(node: CanvasNode): Bounds {
	const { x, y, width, height, rotation } = node.spatial
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const [dx, dy] of [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	]) {
		const px = x + dx * cos - dy * sin
		const py = y + dx * sin + dy * cos
		minX = Math.min(minX, px)
		minY = Math.min(minY, py)
		maxX = Math.max(maxX, px)
		maxY = Math.max(maxY, py)
	}
	return { minX, minY, maxX, maxY }
}

export function CompanionFocusOverlay() {
	const editor = useEditor()
	const focus = useValue(companionFocus)
	const canvas = useCanvasDocument()
	const zoom = useValue('zoom level', () => editor.getZoomLevel(), [editor])

	if (focus.length === 0) return null

	// A focus id can name a note deleted since the remark; skip it rather than draw nothing.
	const nodes = focus
		.map((id) => canvas.nodes[id])
		.filter((node): node is CanvasNode => node !== undefined)
	if (nodes.length === 0) return null

	const boxes = nodes.map(nodeBounds)
	const region: Bounds = {
		minX: Math.min(...boxes.map((b) => b.minX)) - REGION_PAD,
		minY: Math.min(...boxes.map((b) => b.minY)) - REGION_PAD,
		maxX: Math.max(...boxes.map((b) => b.maxX)) + REGION_PAD,
		maxY: Math.max(...boxes.map((b) => b.maxY)) + REGION_PAD,
	}

	return (
		<>
			<div
				data-companion-focus-region=""
				aria-hidden="true"
				style={{
					position: 'absolute',
					left: region.minX,
					top: region.minY,
					width: region.maxX - region.minX,
					height: region.maxY - region.minY,
					borderRadius: 16,
					// Divided by zoom to hold a constant screen thickness through the camera layer.
					border: `${2 / zoom}px solid ${FOCUS_INK}`,
					background: focusTint(0.06),
					pointerEvents: 'none',
				}}
			/>
			{nodes.map((node, index) => {
				const box = boxes[index]
				return (
					<div
						key={node.id}
						data-companion-focus={node.id}
						aria-hidden="true"
						style={{
							position: 'absolute',
							left: box.minX - RING_PAD,
							top: box.minY - RING_PAD,
							width: box.maxX - box.minX + RING_PAD * 2,
							height: box.maxY - box.minY + RING_PAD * 2,
							borderRadius: 6,
							border: `${2.5 / zoom}px solid ${FOCUS_INK}`,
							pointerEvents: 'none',
						}}
					/>
				)
			})}
		</>
	)
}
