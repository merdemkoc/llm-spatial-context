/**
 * The grounded screenshot: a PNG of the canvas with every canonical Node
 * outlined and labelled, plus the JSON that says which label is which node.
 *
 * The point is to give a model a third way to reach the same entity. It already
 * has the semantic one (`content.text`) and the spatial one (`spatial`, plus the
 * derived `spatialContext`); what it lacked was any statement of which pixels
 * belong to which id, and inferring that from coordinates is exactly the guess
 * this project exists to remove.
 *
 * `grounding` is an **export concern, not a canonical layer**. It says nothing
 * about the canvas — only about one image of it — and labels renumber whenever
 * the layout changes, so it has no business in `CanvasDocument`. It rides along
 * in the artifact instead, as a superset the Inspector's import still accepts.
 *
 * Everything that can be wrong about where a box lands lives in `projection.ts`
 * and `annotationLayer.ts`, which are pure and tested. What's left here is the
 * browser: rasterising, compositing and saving.
 */
import { Box, type Editor } from 'tldraw'
import type { CanvasDocument, NodeId } from '@/domain'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'
import {
	GROUNDING_PADDING,
	drawGroundingLayer,
	type Annotation,
} from '@/canvas/grounding/annotationLayer'
import { groundingProjection, imageScale, nodeImageQuad } from '@/canvas/grounding/projection'
import { assignVisualIds, type GroundedNode, type VisualId } from '@/canvas/grounding/visualId'

/** Visual id → canonical node id. The one explicit statement of correspondence. */
export type Grounding = Record<VisualId, NodeId>

export type GroundedCanvasDocument = CanvasDocument & { grounding: Grounding }

export interface GroundedScreenshot {
	png: Blob
	document: GroundedCanvasDocument
}

/**
 * The canonical document, plus the map. Pure — the labels come from node
 * geometry alone, so this is the same map the image is drawn with.
 */
export function groundedDocument(canvas: CanvasDocument): GroundedCanvasDocument {
	return withGrounding(canvas, assignVisualIds(Object.values(canvas.nodes)))
}

function withGrounding(canvas: CanvasDocument, labelled: GroundedNode[]): GroundedCanvasDocument {
	const grounding: Grounding = {}
	for (const { visualId, node } of labelled) grounding[visualId] = node.id

	return { ...canvas, grounding }
}

/**
 * Renders the canvas and draws the grounding layer over it.
 *
 * The image covers every node rather than the current viewport: grounding a node
 * that isn't in the picture would be worse than not grounding it at all.
 */
export async function buildGroundedScreenshot(editor: Editor): Promise<GroundedScreenshot> {
	const canvas = getCanvasDocument(editor)

	const nodes = Object.values(canvas.nodes)
	if (nodes.length === 0) throw new Error('There is nothing on the canvas to ground')

	// One labelling pass feeds both halves of the artifact. Labelling twice would
	// give the same answer today — it's pure — but it would leave "the boxes and
	// the map agree" as a coincidence rather than a fact.
	const labelled = assignVisualIds(nodes)
	const projection = groundingProjection(nodes, GROUNDING_PADDING)

	// Every shape on the page, not just the post-its. The image is the canvas as
	// it is — a user's arrows and drawings belong in it — and the grounding layer
	// then names the subset that is canonical. Passing explicit `bounds` with
	// `padding: 0` is what makes the world → image mapping knowable: tldraw's
	// default `padding: 'auto'` trims the export to its visual content, which
	// would move the origin out from under us.
	const image = await editor.toImage([...editor.getCurrentPageShapeIds()], {
		format: 'png',
		background: true,
		padding: 0,
		bounds: new Box(projection.minX, projection.minY, projection.width, projection.height),
	})

	// Decoded before any geometry is computed, because the scale every annotation
	// is sized and placed by can only be measured from the bitmap.
	const bitmap = await createImageBitmap(image.blob)

	try {
		const scale = imageScale(projection, bitmap)

		const annotations: Annotation[] = labelled.map(({ visualId, node }) => ({
			visualId,
			quad: nodeImageQuad(node, projection, scale),
		}))

		return {
			png: await composite(bitmap, annotations, scale),
			document: withGrounding(canvas, labelled),
		}
	} finally {
		bitmap.close()
	}
}

/** Builds the artifact and saves both halves of it. */
export async function exportGroundedScreenshot(editor: Editor): Promise<void> {
	const screenshot = await buildGroundedScreenshot(editor)
	saveGroundedScreenshot(screenshot)
}

/**
 * The original canvas first, the grounding layer over it. Nothing is drawn
 * filled, so what was underneath is still readable through the annotation.
 */
async function composite(
	bitmap: ImageBitmap,
	annotations: Annotation[],
	scale: number
): Promise<Blob> {
	const target = window.document.createElement('canvas')
	target.width = bitmap.width
	target.height = bitmap.height

	const ctx = target.getContext('2d')
	if (!ctx) throw new Error('Could not get a 2D context to draw the grounding layer')

	ctx.drawImage(bitmap, 0, 0)
	drawGroundingLayer(ctx, annotations, scale)

	return toBlob(target)
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the grounded PNG'))),
			'image/png'
		)
	)
}

/**
 * One timestamp for both files. Labels renumber when the layout changes, so a
 * PNG paired with the wrong JSON would disagree silently; matching names are
 * what make the pair recognisable as a pair.
 */
function saveGroundedScreenshot({ png, document }: GroundedScreenshot): void {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')

	save(png, `grounded-canvas-${stamp}.png`)
	save(
		new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
		`grounded-canvas-${stamp}.json`
	)
}

function save(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)

	const link = window.document.createElement('a')
	link.href = url
	link.download = filename
	link.click()

	// Not revoked synchronously: Safari has been known to cancel a download whose
	// object URL disappears in the same task as the click.
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
