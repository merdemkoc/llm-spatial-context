/**
 * The grounding layer: an outline around each node and a short label naming it.
 *
 * This is an *index*, not an interpretation. It draws where the JSON's entities
 * are and nothing else — no relation lines, no influence rings, no distance
 * indicators. Those claims already exist in `relations` and `spatialContext`,
 * and putting them on the image would mix a derived reading into what is meant
 * to be a lookup table between pixels and ids.
 *
 * The outline is never filled, so the canvas underneath survives intact. The
 * only opaque pixels added are the label badges, and they sit outside the
 * outlines they belong to.
 *
 * Every size below is in design units multiplied by the image scale, so
 * annotations stay proportionate whatever pixel ratio the export ends up at.
 */
import type { Point, VisualId } from '@/domain'

/**
 * A structural subset of `CanvasRenderingContext2D` — a real 2D context
 * satisfies it, and so does a recorder in a test. `measureText` is narrowed to
 * the one field used, since a fake has no business inventing the rest of
 * `TextMetrics`.
 */
export interface GroundingContext {
	lineWidth: number
	strokeStyle: string | CanvasGradient | CanvasPattern
	fillStyle: string | CanvasGradient | CanvasPattern
	font: string
	textBaseline: CanvasTextBaseline

	save(): void
	restore(): void
	beginPath(): void
	moveTo(x: number, y: number): void
	lineTo(x: number, y: number): void
	closePath(): void
	stroke(): void
	fillRect(x: number, y: number, width: number, height: number): void
	fillText(text: string, x: number, y: number): void
	measureText(text: string): { width: number }
}

export interface Annotation {
	visualId: VisualId
	/** Image pixels, clockwise from the node's top-left corner. */
	quad: Point[]
}

export const BOX_STROKE_WIDTH = 2
export const LABEL_FONT_SIZE = 13

const LABEL_PADDING_X = 5
const LABEL_PADDING_Y = 3
/** Between the badge's bottom edge and the outline, so neither obscures the other. */
const LABEL_GAP = 2

/**
 * Hot pink, for both the outline and the badge. Chosen to be obviously *not*
 * canvas content: it reads clearly against the default pale-yellow post-it and
 * against white, and no post-it palette entry is close to it.
 */
const ANNOTATION_COLOR = '#FF2D95'
const LABEL_TEXT_COLOR = '#FFFFFF'

const LABEL_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/**
 * How much room to leave around the nodes when exporting, in world units.
 *
 * It lives here rather than beside the projection because the constraint is the
 * label's: a badge is drawn *above* its node, so the topmost node's badge falls
 * outside the nodes' own bounds. This has to stay comfortably larger than
 * `labelHeight` and a badge's width, or the first label would be cropped off
 * the top of the image. That relationship is what makes clamping unnecessary.
 */
export const GROUNDING_PADDING = 40

export function drawGroundingLayer(
	ctx: GroundingContext,
	annotations: Annotation[],
	scale: number
): void {
	for (const annotation of annotations) {
		drawOutline(ctx, annotation.quad, scale)
		drawLabel(ctx, annotation.visualId, annotation.quad[0], scale)
	}
}

function drawOutline(ctx: GroundingContext, quad: Point[], scale: number): void {
	ctx.save()

	ctx.lineWidth = BOX_STROKE_WIDTH * scale
	ctx.strokeStyle = ANNOTATION_COLOR

	ctx.beginPath()
	ctx.moveTo(quad[0].x, quad[0].y)
	for (const corner of quad.slice(1)) ctx.lineTo(corner.x, corner.y)
	ctx.closePath()
	ctx.stroke()

	ctx.restore()
}

/**
 * Anchored to the node's top-left corner as *rendered*, which for a rotated
 * node is wherever the rotation put it. The badge follows its node rather than
 * sitting at the corner of some axis-aligned box the node isn't in.
 */
function drawLabel(ctx: GroundingContext, visualId: VisualId, anchor: Point, scale: number): void {
	ctx.save()

	ctx.font = `${LABEL_FONT_SIZE * scale}px ${LABEL_FONT_STACK}`
	ctx.textBaseline = 'top'

	const textWidth = ctx.measureText(visualId).width
	const width = textWidth + LABEL_PADDING_X * 2 * scale
	const height = LABEL_FONT_SIZE * scale + LABEL_PADDING_Y * 2 * scale

	const x = anchor.x
	const y = anchor.y - height - LABEL_GAP * scale

	ctx.fillStyle = ANNOTATION_COLOR
	ctx.fillRect(x, y, width, height)

	ctx.fillStyle = LABEL_TEXT_COLOR
	ctx.fillText(visualId, x + LABEL_PADDING_X * scale, y + LABEL_PADDING_Y * scale)

	ctx.restore()
}
