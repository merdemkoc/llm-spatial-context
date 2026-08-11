/**
 * The grounding layer: an outline around each node, a short label naming it, and
 * the gravity of each relation the user drew.
 *
 * This is an *index*, not an interpretation. Every mark on it names something the
 * JSON already states about something the user made: a node's region, or the
 * strength they assigned an arrow. Nothing *derived* is drawn — no influence
 * rings, no distance indicators, no lines between nodes that have none. Those
 * claims live in `spatialContext`, and putting them on the image would mix a
 * reading of the canvas into what is meant to be a lookup table between pixels
 * and ids.
 *
 * A gravity badge is on the right side of that line: the arrow is already in the
 * picture — it is canvas content — and the badge only labels which of the JSON's
 * relations it is, the same service the `N1` badge does for a node.
 *
 * The outline is never filled, so the canvas underneath survives intact. The only
 * opaque pixels added are the badges: a node's sits outside the outline it belongs
 * to, while a relation's sits wherever its two endpoints put it — which for two
 * nearly-touching nodes can be over one of them.
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

/**
 * One relation's badge: what to write, and where.
 *
 * Carries a formatted `label` rather than a number, so the caller owns how a
 * gravity reads and this module owns only how a badge is drawn.
 */
export interface RelationAnnotation {
	label: string
	/** Image pixels. The badge is centred here rather than anchored by a corner. */
	at: Point
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

/**
 * `relations` is last and optional because it is the newer half of the layer, and
 * a caller with nothing to say about relations should not have to say it — an
 * empty list draws exactly what this drew before relations had a gravity.
 */
export function drawGroundingLayer(
	ctx: GroundingContext,
	annotations: Annotation[],
	scale: number,
	relations: RelationAnnotation[] = []
): void {
	for (const annotation of annotations) {
		drawOutline(ctx, annotation.quad, scale)
		drawLabel(ctx, annotation.visualId, annotation.quad[0], scale)
	}

	// After the outlines, so a badge that lands on one is legible over it. Node
	// badges sit outside their outlines and don't have this problem; a relation's
	// sits wherever the two nodes put it.
	for (const relation of relations) {
		drawBadge(ctx, relation.label, relation.at, scale, 'center')
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

/** Independent of the text, so it can be known before anything is measured. */
function badgeHeight(scale: number): number {
	return LABEL_FONT_SIZE * scale + LABEL_PADDING_Y * 2 * scale
}

/**
 * Anchored to the node's top-left corner as *rendered*, which for a rotated
 * node is wherever the rotation put it. The badge follows its node rather than
 * sitting at the corner of some axis-aligned box the node isn't in.
 */
function drawLabel(ctx: GroundingContext, visualId: VisualId, anchor: Point, scale: number): void {
	drawBadge(
		ctx,
		visualId,
		{ x: anchor.x, y: anchor.y - badgeHeight(scale) - LABEL_GAP * scale },
		scale,
		'corner'
	)
}

/**
 * A filled box with the text in it — the only opaque pixels this layer adds.
 *
 * `'corner'` places `at` at its top-left; `'center'` puts `at` in its middle,
 * which is what a relation needs: its point is a position on the arrow, not a
 * corner of anything. Centring has to happen here because it needs the measured
 * width, and measuring needs the font this function sets.
 */
function drawBadge(
	ctx: GroundingContext,
	text: string,
	at: Point,
	scale: number,
	anchor: 'corner' | 'center'
): void {
	ctx.save()

	ctx.font = `${LABEL_FONT_SIZE * scale}px ${LABEL_FONT_STACK}`
	ctx.textBaseline = 'top'

	const width = ctx.measureText(text).width + LABEL_PADDING_X * 2 * scale
	const height = badgeHeight(scale)

	const x = anchor === 'center' ? at.x - width / 2 : at.x
	const y = anchor === 'center' ? at.y - height / 2 : at.y

	ctx.fillStyle = ANNOTATION_COLOR
	ctx.fillRect(x, y, width, height)

	ctx.fillStyle = LABEL_TEXT_COLOR
	ctx.fillText(text, x + LABEL_PADDING_X * scale, y + LABEL_PADDING_Y * scale)

	ctx.restore()
}
