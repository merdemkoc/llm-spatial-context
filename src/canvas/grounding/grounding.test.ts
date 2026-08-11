/**
 * The grounding layer of the exported document.
 *
 * Coordinates are hand-checkable throughout: post-its are 240×160, the padding
 * is whatever the test passes, and a scale of 2 doubles everything. A projection
 * built from one node at the origin with padding 40 therefore starts at
 * `(-40, -40)` and the node's top-left lands at `(80, 80)` in the image.
 */
import { describe, expect, it } from 'vitest'
import { createPostItNode, type CanvasDocument, type PostItNode, type Relation } from '@/domain'
import {
	buildGrounding,
	deriveGrounding,
	formatGravity,
	groundedDocument,
	relationAnnotations,
} from '@/canvas/grounding/grounding'
import { groundingProjection } from '@/canvas/grounding/projection'
import { assignRelationVisualIds, assignVisualIds } from '@/canvas/grounding/visualId'

const NOW = '2026-08-10T12:00:00.000Z'

function node(id: string, x: number, y: number, rotation?: number): PostItNode {
	return createPostItNode({ id, x, y, rotation, now: NOW })
}

/** What the export does: one labelling pass, one projection, one measured image. */
function ground(nodes: PostItNode[], padding = 40, scale = 2) {
	const projection = groundingProjection(nodes, padding)

	return buildGrounding(assignVisualIds(nodes), projection, {
		width: projection.width * scale,
		height: projection.height * scale,
	})
}

describe('buildGrounding', () => {
	it('reports the image it was measured against', () => {
		const grounding = ground([node('a', 0, 0)])

		expect(grounding.image).toEqual({ width: 640, height: 480 })
	})

	it('maps each visual id to its canonical node id', () => {
		const grounding = ground([node('top', 0, 0), node('bottom', 0, 400)])

		expect(grounding.nodes.N1.nodeId).toBe('top')
		expect(grounding.nodes.N2.nodeId).toBe('bottom')
	})

	/**
	 * The padding puts the node's top-left at `(40, 40)` in world space, which at
	 * scale 2 is `(80, 80)`; the node is 240×160, so it ends at `(560, 400)`.
	 */
	it('reports the bbox in screenshot pixels, not canvas coordinates', () => {
		const grounding = ground([node('a', 300, 200)])

		expect(grounding.nodes.N1.bbox).toEqual([80, 80, 560, 400])
	})

	it('reports whole pixels', () => {
		const grounding = ground([node('a', 0.3, 0.7)], 40, 1.7)

		for (const value of grounding.nodes.N1.bbox) {
			expect(Number.isInteger(value)).toBe(true)
		}
	})

	/** Every bbox has to be inside the image it claims to be a region of. */
	it('keeps every bbox inside the image', () => {
		const grounding = ground([node('a', 0, 0), node('b', 700, 300, 0.6), node('c', -200, 500)])

		for (const { bbox } of Object.values(grounding.nodes)) {
			const [x1, y1, x2, y2] = bbox

			expect(x1).toBeGreaterThanOrEqual(0)
			expect(y1).toBeGreaterThanOrEqual(0)
			expect(x2).toBeLessThanOrEqual(grounding.image.width)
			expect(y2).toBeLessThanOrEqual(grounding.image.height)
		}
	})

	/**
	 * The export measures the image from a decoded `ImageBitmap`, whose `width` and
	 * `height` are prototype getters rather than own properties — holding onto that
	 * object would serialise `image` as `{}`. Copying the two numbers out is what
	 * makes the layer safe to hand any image-shaped thing.
	 */
	it('copies the image size out rather than holding the caller’s object', () => {
		const nodes = [node('a', 0, 0)]
		const projection = groundingProjection(nodes, 40)

		const bitmapLike = Object.create({
			get width() {
				return 640
			},
			get height() {
				return 480
			},
		}) as { width: number; height: number }

		const grounding = buildGrounding(assignVisualIds(nodes), projection, bitmapLike)

		expect(JSON.parse(JSON.stringify(grounding)).image).toEqual({ width: 640, height: 480 })
	})

	it('grounds nothing when there is nothing labelled', () => {
		const projection = groundingProjection([], 40)

		expect(buildGrounding([], projection, { width: 0, height: 0 }).nodes).toEqual({})
	})
})

describe('deriveGrounding', () => {
	/**
	 * The reason a live document can carry this layer at all: the export's pixel
	 * size is `floor(bounds × 2)`, so predicting it is arithmetic rather than a
	 * guess. Verified against a real export, which produced exactly these numbers
	 * for these bounds.
	 */
	it('predicts the size the export will rasterise at', () => {
		// Bounds span x 0…640 and y 0…200, expanded by 40 of padding on each side:
		// 720 × 280 world units, doubled.
		const grounding = deriveGrounding([node('a', 0, 0), node('b', 400, 40)])

		expect(grounding.image).toEqual({ width: 1440, height: 560 })
	})

	it('grounds every node without needing an editor or an image', () => {
		const grounding = deriveGrounding([node('bottom', 0, 900), node('top', 0, 0)])

		expect(grounding.nodes.N1.nodeId).toBe('top')
		expect(grounding.nodes.N2.nodeId).toBe('bottom')
	})

	it('grounds nothing on an empty canvas rather than failing', () => {
		// Both maps present and empty, not absent: a reader needs to see "nothing is
		// grounded" rather than infer it from a missing key, the same rule
		// `spatialContext` follows.
		expect(deriveGrounding([])).toEqual({
			image: { width: 0, height: 0 },
			nodes: {},
			relations: {},
		})
	})

	/**
	 * Regression, and the reason this layer validates nothing.
	 *
	 * `getCanvasDocument` runs inside a reactive computed, so anything it throws
	 * takes the editor down — dragging a post-it to a fractional position used to
	 * crash the app, because the derived image size floored to an aspect ratio the
	 * scale check rejected. A derived layer is like `calculateSpatialInfluence`: an
	 * unvalidated canvas is a normal state to be in, not an error to interrupt a
	 * render for. The export validates the bitmap it really produced; this doesn't.
	 */
	it('never throws, whatever the aspect ratio and however fractional the layout', () => {
		const layouts = [
			[node('a', 0.42578125, 0.99609375), node('b', 741.13, 257.99609375)],
			[node('a', 0.1, 0.7), node('b', 0.3, 1503.9)],
			[node('a', -1200.55, 0.05), node('b', 1200.35, 3.95)],
			[node('a', 0, 0, Math.PI / 7)],
			[node('a', 0.5, 0.5)],
		]

		for (const nodes of layouts) {
			expect(() => deriveGrounding(nodes)).not.toThrow()

			const grounding = deriveGrounding(nodes)
			for (const { bbox } of Object.values(grounding.nodes)) {
				for (const value of bbox) expect(Number.isFinite(value)).toBe(true)
			}
		}
	})
})

describe('formatGravity', () => {
	/** The prefix is what keeps a badge from reading as a distance or a node label. */
	it('names the quantity it shows', () => {
		expect(formatGravity(1)).toBe('g 1.00')
		expect(formatGravity(0.35)).toBe('g 0.35')
	})

	it('shows a zero rather than nothing', () => {
		expect(formatGravity(0)).toBe('g 0.00')
	})
})

describe('relationAnnotations', () => {
	const nodes = { a: node('a', 0, 0), b: node('b', 600, 0) }
	const projection = groundingProjection(Object.values(nodes), 40)

	function relation(overrides: Partial<Relation> = {}): Record<string, Relation> {
		return { r1: { id: 'r1', from: 'a', to: 'b', gravity: 1, ...overrides } }
	}

	/** What the adapter measures off the drawn arrow. */
	function measured(relationId = 'r1', midpoint = { x: 420, y: 80 }) {
		return assignRelationVisualIds([
			{
				relationId,
				bounds: { minX: 120, minY: 60, maxX: 720, maxY: 100 },
				midpoint,
			},
		])
	}

	it('labels a relation with its visual id and gravity, on the measured path point', () => {
		const annotations = relationAnnotations(relation({ gravity: 0.35 }), measured(), projection, 2)

		// The measured point is (420, 80) and the projection starts at (-40, -40), so
		// at scale 2 that lands at (920, 240).
		expect(annotations).toEqual([{ label: 'R1 g 0.35', at: { x: 920, y: 240 } }])
	})

	it('follows the measured point rather than the nodes’ midpoint', () => {
		// A bowed arrow between the same two notes. The old behaviour pinned this to
		// (420, 80) whatever the arrow did.
		const bowed = relationAnnotations(relation(), measured('r1', { x: 420, y: 500 }), projection, 2)

		expect(bowed[0].at).toEqual({ x: 920, y: 1080 })
	})

	/** The label says what the JSON says: the badge can't drift from the document. */
	it('reads the gravity from the relation rather than recomputing anything', () => {
		expect(relationAnnotations(relation({ gravity: 0 }), measured(), projection, 2)[0].label).toBe(
			'R1 g 0.00'
		)
	})

	it('is empty when nothing is related', () => {
		expect(relationAnnotations({}, [], projection, 2)).toEqual([])
	})

	/**
	 * An imported document can disagree with itself. A badge floating over nothing
	 * would be worse than a missing one — it would point confidently at empty canvas.
	 */
	it('skips a measured arrow whose relation is not in the document', () => {
		expect(relationAnnotations({}, measured('ghost'), projection, 2)).toEqual([])
	})

	it('skips a relation the renderer could not measure', () => {
		// No geometry means no badge, rather than a badge at a guessed position.
		expect(relationAnnotations(relation(), [], projection, 2)).toEqual([])
	})

	it('annotates every relation, numbering them in reading order', () => {
		const both: Record<string, Relation> = {
			r1: { id: 'r1', from: 'a', to: 'b', gravity: 1 },
			r2: { id: 'r2', from: 'b', to: 'a', gravity: 0.5 },
		}

		// r2 bows above r1, so it is the one that reads first.
		const labelled = assignRelationVisualIds([
			{
				relationId: 'r1',
				bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
				midpoint: { x: 420, y: 300 },
			},
			{
				relationId: 'r2',
				bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
				midpoint: { x: 420, y: 20 },
			},
		])

		expect(relationAnnotations(both, labelled, projection, 2).map((a) => a.label)).toEqual([
			'R1 g 0.50',
			'R2 g 1.00',
		])
	})
})

describe('groundedDocument', () => {
	const canvas: CanvasDocument = {
		id: 'canvas-1',
		nodes: { a: node('a', 0, 0) },
		relations: {},
		spatialContext: { influences: [], effectiveStrengths: [] },
		grounding: { image: { width: 1, height: 1 }, nodes: {}, relations: {} },
		metadata: { createdAt: NOW, updatedAt: NOW },
	}

	it('replaces the derived grounding with the one it is given', () => {
		const measured = ground([node('a', 0, 0)])

		expect(groundedDocument(canvas, measured).grounding).toBe(measured)
	})

	it('keeps `grounding` in its declared position, before the metadata footer', () => {
		expect(Object.keys(groundedDocument(canvas, ground([node('a', 0, 0)])))).toEqual([
			'id',
			'nodes',
			'relations',
			'spatialContext',
			'grounding',
			'metadata',
		])
	})

	it('leaves the canonical document it was given alone', () => {
		const original = canvas.grounding

		groundedDocument(canvas, ground([node('a', 0, 0)]))

		expect(canvas.grounding).toBe(original)
	})
})
