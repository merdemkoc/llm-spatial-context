/**
 * Where a relation's arrow actually runs — measured, not inferred.
 *
 * The canonical `Relation` says which two nodes are connected and deliberately
 * nothing about how the line got there: no anchor, no bend, no terminal. That is
 * the right model of the *claim*, and it is exactly what makes an exported picture
 * hard to annotate, because a curve on an image has a position and the claim
 * doesn't mention it.
 *
 * The previous answer was to synthesise one — the midpoint of the two node centres
 * — which had the virtue of being re-derivable from the canonical JSON alone. It
 * was wrong for any arrow that isn't straight: a bowed arrow never passes through
 * that point, so badges floated in empty space, and in a real export one landed on
 * an unrelated node's label and read as that node's gravity.
 *
 * So this module reads the drawn path from tldraw and hands the grounding layer
 * plain world-space numbers. It is the adapter's job by construction: the grounding
 * layer stays pure, and the one place that knows both sides is the one place that
 * touches the editor.
 */
import { getArrowInfo, type Editor, type TLShapeId } from 'tldraw'
import type { Point, Relation, RelationGeometry, RelationId } from '@/domain'
import { relationIdToShapeId } from '@/canvas/adapter/ids'

/**
 * Geometry for every relation whose arrow can still be measured, in world units.
 *
 * Driven from the `relations` already projected out of the page rather than by
 * walking the arrows again, so the two cannot disagree about which arrows count —
 * `getCanvasRelations` owns the four guards that decide what is a relation, and
 * re-deciding them here would be a second, drifting copy of that rule.
 *
 * An arrow that can't be measured is **omitted rather than approximated**. Every
 * caller treats a missing geometry as "no badge, no bbox, no contribution to the
 * export bounds", which is the honest outcome: the alternative is a mark placed
 * where the arrow isn't, and that is the bug this module exists to fix.
 */
export function getRelationGeometry(
	editor: Editor,
	relations: Record<RelationId, Relation>
): RelationGeometry[] {
	const geometry: RelationGeometry[] = []

	for (const relationId of Object.keys(relations)) {
		const measured = measure(editor, relationId)
		if (measured) geometry.push(measured)
	}

	return geometry
}

/**
 * One arrow's geometry, or nothing — and **never a throw**.
 *
 * The catch is not defensive habit, it is a hard requirement of where this runs.
 * `getCanvasDocument` calls it from inside a reactive computed, so anything that
 * escapes here takes the editor down rather than costing one badge. And the calls
 * below reach further into tldraw than they look: measuring an arrow resolves its
 * label, which resolves the label's fonts, which throws outright on an editor
 * created without `textOptions`. A headless editor is exactly that.
 *
 * Every caller already treats a missing geometry as "no badge, no bbox, no
 * contribution to the export bounds", so degrading to that is the graceful
 * outcome. Losing an annotation is a smaller failure than losing the canvas.
 */
function measure(editor: Editor, relationId: RelationId): RelationGeometry | undefined {
	const shapeId = relationIdToShapeId(relationId)

	try {
		// Page bounds, not local: they are what the export box has to hold, and they
		// already include the bow of a curved arrow rather than just its endpoints.
		const bounds = editor.getShapePageBounds(shapeId)
		const midpoint = arrowMidpoint(editor, shapeId)
		if (!bounds || !midpoint) return undefined

		// A non-finite bound would propagate into the export box and produce an image
		// of no size, which fails far from here with nothing pointing back to an arrow.
		const numbers = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, midpoint.x, midpoint.y]
		if (!numbers.every(Number.isFinite)) return undefined

		return {
			relationId,
			bounds: {
				minX: bounds.minX,
				minY: bounds.minY,
				maxX: bounds.maxX,
				maxY: bounds.maxY,
			},
			midpoint,
		}
	} catch {
		return undefined
	}
}

/**
 * A point on the arrow's drawn path, in world coordinates.
 *
 * `getArrowInfo` reports one directly for the two curve kinds — `middle` is on the
 * arc for an `arc` arrow and the true midpoint for a `straight` one. An `elbow`
 * arrow has no such field, only the polyline it routes along, so the point is
 * walked out of that: half the route's length, which lands on a segment rather
 * than at a corner.
 *
 * Everything `getArrowInfo` returns is in the arrow shape's own space, so the
 * result is pushed through the shape's page transform. Skipping that step would
 * put every badge at an offset equal to the arrow's own position — plausible-
 * looking, and wrong by hundreds of units.
 */
function arrowMidpoint(editor: Editor, shapeId: TLShapeId): Point | undefined {
	const info = getArrowInfo(editor, shapeId)
	if (!info) return undefined

	const local = info.type === 'elbow' ? routeMidpoint(info.route.points) : info.middle
	if (!local) return undefined

	const transform = editor.getShapePageTransform(shapeId)
	if (!transform) return undefined

	const { x, y } = transform.applyToPoint(local)
	return { x, y }
}

/**
 * The point half way along a polyline, by arc length rather than by vertex count.
 *
 * Counting vertices would put the mark at whichever corner happens to be in the
 * middle of the list, which for an L-shaped route is the corner itself — the one
 * place on an elbow arrow a badge is least legible.
 */
function routeMidpoint(points: readonly Point[]): Point | undefined {
	if (points.length === 0) return undefined
	if (points.length === 1) return { x: points[0].x, y: points[0].y }

	const segments: number[] = []
	let total = 0

	for (let i = 1; i < points.length; i++) {
		const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
		segments.push(length)
		total += length
	}

	// A zero-length route is a degenerate arrow — both ends in the same place. Its
	// first point is as good an answer as exists, and dividing by `total` below
	// would produce NaN.
	if (total === 0) return { x: points[0].x, y: points[0].y }

	let travelled = 0

	for (let i = 0; i < segments.length; i++) {
		const next = travelled + segments[i]

		if (next >= total / 2) {
			// How far into *this* segment the halfway mark falls.
			const fraction = segments[i] === 0 ? 0 : (total / 2 - travelled) / segments[i]

			return {
				x: points[i].x + (points[i + 1].x - points[i].x) * fraction,
				y: points[i].y + (points[i + 1].y - points[i].y) * fraction,
			}
		}

		travelled = next
	}

	// Unreachable while `total > 0` — the loop above always crosses the halfway
	// mark — but returning the last point is the right answer if it ever isn't.
	return { x: points[points.length - 1].x, y: points[points.length - 1].y }
}
