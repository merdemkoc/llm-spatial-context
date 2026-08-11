/**
 * The annotation layer, recorded rather than rasterised.
 *
 * jsdom's `getContext('2d')` returns `null` without `node-canvas`, and pulling
 * in a native canvas build to check that four `lineTo` calls happened is a poor
 * trade. `drawGroundingLayer` is typed against a structural subset of
 * `CanvasRenderingContext2D`, so a recorder satisfies it and the assertions can
 * be about the drawing commands themselves.
 */
import { describe, expect, it } from 'vitest'
import type { Point } from '@/domain'
import {
	BOX_STROKE_WIDTH,
	LABEL_FONT_SIZE,
	drawGroundingLayer,
	type Annotation,
	type GroundingContext,
} from '@/canvas/grounding/annotationLayer'

type Call = [string, ...unknown[]]

interface Recorder extends GroundingContext {
	calls: Call[]
}

/** Character width is arbitrary but fixed, so badge geometry is predictable. */
const CHARACTER_WIDTH = 8

function recorder(): Recorder {
	const calls: Call[] = []

	return {
		calls,
		lineWidth: 0,
		strokeStyle: '',
		fillStyle: '',
		font: '',
		textBaseline: 'alphabetic',
		save: () => calls.push(['save']),
		restore: () => calls.push(['restore']),
		beginPath: () => calls.push(['beginPath']),
		moveTo: (x, y) => calls.push(['moveTo', x, y]),
		lineTo: (x, y) => calls.push(['lineTo', x, y]),
		closePath: () => calls.push(['closePath']),
		stroke: () => calls.push(['stroke']),
		fillRect: (x, y, width, height) => calls.push(['fillRect', x, y, width, height]),
		fillText: (text, x, y) => calls.push(['fillText', text, x, y]),
		measureText: (text) => ({ width: text.length * CHARACTER_WIDTH }),
	}
}

function rect(x: number, y: number, width: number, height: number): Point[] {
	return [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
	]
}

function annotation(visualId: string, quad: Point[]): Annotation {
	return { visualId, quad }
}

function callsNamed(ctx: Recorder, name: string): Call[] {
	return ctx.calls.filter((call) => call[0] === name)
}

describe('drawGroundingLayer', () => {
	it('strokes one closed outline per annotation', () => {
		const ctx = recorder()

		drawGroundingLayer(
			ctx,
			[annotation('N1', rect(0, 0, 100, 80)), annotation('N2', rect(200, 300, 100, 80))],
			1
		)

		expect(callsNamed(ctx, 'stroke')).toHaveLength(2)
		expect(callsNamed(ctx, 'closePath')).toHaveLength(2)
	})

	it('traces exactly the quad it was given', () => {
		const ctx = recorder()
		const quad = [
			{ x: 10, y: 20 },
			{ x: 90, y: 30 },
			{ x: 80, y: 70 },
			{ x: 0, y: 60 },
		]

		drawGroundingLayer(ctx, [annotation('N1', quad)], 1)

		expect(ctx.calls.filter((call) => call[0] === 'moveTo' || call[0] === 'lineTo')).toEqual([
			['moveTo', 10, 20],
			['lineTo', 90, 30],
			['lineTo', 80, 70],
			['lineTo', 0, 60],
		])
	})

	it('labels each annotation once, in the order given', () => {
		const ctx = recorder()

		drawGroundingLayer(
			ctx,
			[
				annotation('N1', rect(0, 0, 100, 80)),
				annotation('N2', rect(200, 0, 100, 80)),
				annotation('N3', rect(400, 0, 100, 80)),
			],
			1
		)

		expect(callsNamed(ctx, 'fillText').map((call) => call[1])).toEqual(['N1', 'N2', 'N3'])
	})

	/**
	 * Requirement: the grounded screenshot preserves the original canvas. The
	 * layer identifies where a node is; it must not paint over what the node
	 * says, so the only opaque pixels it adds are the label badge and those sit
	 * outside the outline.
	 */
	it('never fills over a node’s interior', () => {
		const ctx = recorder()
		const quad = rect(100, 100, 240, 160)

		drawGroundingLayer(ctx, [annotation('N1', quad)], 1)

		expect(callsNamed(ctx, 'fill')).toHaveLength(0)
		for (const [, x, y, width, height] of callsNamed(ctx, 'fillRect')) {
			const overlapsHorizontally = (x as number) < 340 && (x as number) + (width as number) > 100
			const overlapsVertically = (y as number) < 260 && (y as number) + (height as number) > 100

			expect(overlapsHorizontally && overlapsVertically).toBe(false)
		}
	})

	it('grows the outline and the label with the scale', () => {
		const scaled = recorder()
		drawGroundingLayer(scaled, [annotation('N1', rect(0, 0, 100, 80))], 3)

		expect(scaled.lineWidth).toBe(BOX_STROKE_WIDTH * 3)
		expect(scaled.font).toContain(`${LABEL_FONT_SIZE * 3}px`)
	})

	it('draws nothing when there is nothing to ground', () => {
		const ctx = recorder()

		drawGroundingLayer(ctx, [], 2)

		expect(ctx.calls).toEqual([])
	})
})

describe('relation badges', () => {
	it('writes each relation’s label once, in the order given', () => {
		const ctx = recorder()

		drawGroundingLayer(ctx, [], 1, [
			{ label: 'g 1.00', at: { x: 100, y: 100 } },
			{ label: 'g 0.35', at: { x: 200, y: 400 } },
		])

		expect(callsNamed(ctx, 'fillText').map((call) => call[1])).toEqual(['g 1.00', 'g 0.35'])
	})

	/**
	 * Centred on the point, not anchored beside it: the point is a position on the
	 * arrow, and a badge hanging off one side of it would drift away from the line
	 * it belongs to as the label got longer.
	 */
	it('centres the badge on the point', () => {
		const ctx = recorder()

		drawGroundingLayer(ctx, [], 1, [{ label: 'g 1.00', at: { x: 500, y: 300 } }])

		const [, x, y, width, height] = callsNamed(ctx, 'fillRect')[0]
		expect((x as number) + (width as number) / 2).toBe(500)
		expect((y as number) + (height as number) / 2).toBe(300)
	})

	it('grows with the scale', () => {
		const ctx = recorder()

		drawGroundingLayer(ctx, [], 3, [{ label: 'g 1.00', at: { x: 500, y: 300 } }])

		expect(ctx.font).toContain(`${LABEL_FONT_SIZE * 3}px`)
	})

	/** No relations is the default, and it must draw exactly what it drew before. */
	it('is absent unless asked for', () => {
		const withRelations = recorder()
		const without = recorder()

		drawGroundingLayer(withRelations, [annotation('N1', rect(0, 0, 100, 80))], 1, [])
		drawGroundingLayer(without, [annotation('N1', rect(0, 0, 100, 80))], 1)

		expect(withRelations.calls).toEqual(without.calls)
	})

	/** Drawn after the outlines, so a badge landing on one stays legible over it. */
	it('draws over the outlines rather than under them', () => {
		const ctx = recorder()

		drawGroundingLayer(ctx, [annotation('N1', rect(0, 0, 100, 80))], 1, [
			{ label: 'g 1.00', at: { x: 50, y: 40 } },
		])

		const lastStroke = ctx.calls.findLastIndex((call) => call[0] === 'stroke')
		const badge = ctx.calls.findLastIndex((call) => call[0] === 'fillText')
		expect(badge).toBeGreaterThan(lastStroke)
	})
})
