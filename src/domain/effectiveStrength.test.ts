/**
 * The combination of the two strength signals.
 *
 * Influences are built by hand rather than from nodes, because that is exactly
 * what `buildEffectiveStrengths` takes — the already-rounded rows the document
 * reports. Every expected number in here is therefore checkable against the
 * strategy's formula with a calculator.
 */
import { describe, expect, it } from 'vitest'
import type { Relation, RelationId } from '@/domain/canvas'
import {
	buildEffectiveStrengths,
	DEFAULT_STRATEGY,
	INTENT_WEIGHT,
	INTENT_WEIGHTED,
	LIFT,
	PRODUCT,
	STRATEGIES,
} from '@/domain/effectiveStrength'
import type { SpatialInfluence } from '@/domain/spatialInfluence'

function influence(source: string, target: string, value: number): SpatialInfluence {
	return { source, target, distance: 100, influence: value }
}

/** Both directions, as `calculateSpatialInfluences` always emits. */
function bothWays(a: string, b: string, forward: number, backward = forward): SpatialInfluence[] {
	return [influence(a, b, forward), influence(b, a, backward)]
}

function relations(...list: Array<Partial<Relation> & { from: string; to: string }>) {
	const record: Record<RelationId, Relation> = {}

	list.forEach((entry, index) => {
		const id = entry.id ?? `r${index + 1}`
		record[id] = { id, gravity: entry.gravity ?? 1, from: entry.from, to: entry.to }
	})

	return record
}

describe('the strategies', () => {
	it('all agree at the corners: no influence and no gravity is no strength', () => {
		for (const strategy of Object.values(STRATEGIES)) {
			expect(strategy.combine(0, 0)).toBe(0)
		}
	})

	it('all agree that full influence and full gravity is full strength', () => {
		for (const strategy of Object.values(STRATEGIES)) {
			expect(strategy.combine(1, 1)).toBe(1)
		}
	})

	describe('product — MVP 0’s literal formula, and why it is not the default', () => {
		it('cannot amplify: a full-strength relation leaves a distant pair exactly as weak', () => {
			// This is the whole argument. MVP 0 asks for `influence x gravity` and in the
			// same breath requires that explicit intent carry "significantly more weight
			// than proximity alone" — and with gravity normalised to 0-1, multiplication
			// gives back the influence unchanged. The requirement contradicts itself, and
			// this is the line that shows it rather than asserting it in a comment.
			expect(PRODUCT.combine(0.35, 1)).toBeCloseTo(0.35, 10)
		})

		it('actively weakens a pair the user deliberately connected', () => {
			// Worse than failing to amplify: a hesitant arrow makes two adjacent notes
			// read as less connected than drawing nothing at all would have.
			expect(PRODUCT.combine(0.9, 0.5)).toBeLessThan(0.9)
		})
	})

	describe('lift — amplifies, but saturates', () => {
		it('reaches full strength at full gravity regardless of distance', () => {
			expect(LIFT.combine(0.35, 1)).toBe(1)
			expect(LIFT.combine(0.9, 1)).toBe(1)
		})

		it('therefore cannot separate two of MVP 0’s four states', () => {
			// Both land on 1, so "explicitly related despite distance" and "spatial and
			// intentional" become the same number. That flattening is why it is not the
			// default, since the default gravity is exactly 1.
			expect(LIFT.combine(0.35, 1)).toBe(LIFT.combine(0.9, 1))
		})
	})

	describe('intent_weighted — the default', () => {
		it('is the default', () => {
			expect(DEFAULT_STRATEGY).toBe(INTENT_WEIGHTED)
			expect(DEFAULT_STRATEGY.name).toBe('intent_weighted')
		})

		it('weights intent at three times proximity', () => {
			expect(INTENT_WEIGHT).toBe(0.75)
			// Gravity alone can reach 0.75; influence alone can reach only 0.25.
			expect(INTENT_WEIGHTED.combine(0, 1)).toBeCloseTo(0.75, 10)
			expect(INTENT_WEIGHTED.combine(1, 0)).toBeCloseTo(0.25, 10)
		})

		it('amplifies where product attenuates', () => {
			// 0.35 x 0.25 + 1 x 0.75 = 0.8375
			expect(INTENT_WEIGHTED.combine(0.35, 1)).toBeCloseTo(0.8375, 10)
			expect(INTENT_WEIGHTED.combine(0.35, 1)).toBeGreaterThan(PRODUCT.combine(0.35, 1))
		})

		it('keeps all four of MVP 0’s states in a strict order', () => {
			// The table the requirement is built around. Low/None must read weakest and
			// High/High strongest, with the two disagreeing states in between and
			// distinguishable from each other — which is what `lift` loses.
			const lowNone = INTENT_WEIGHTED.combine(0.1, 0)
			const highNone = INTENT_WEIGHTED.combine(0.9, 0)
			const lowHigh = INTENT_WEIGHTED.combine(0.1, 1)
			const highHigh = INTENT_WEIGHTED.combine(0.9, 1)

			expect(lowNone).toBeLessThan(highNone)
			expect(highNone).toBeLessThan(lowHigh)
			expect(lowHigh).toBeLessThan(highHigh)
		})

		it('ranks a stated distant relationship above an unstated close one', () => {
			// The single behaviour MVP 0 asks for in one line.
			expect(INTENT_WEIGHTED.combine(0.05, 1)).toBeGreaterThan(INTENT_WEIGHTED.combine(0.95, 0))
		})
	})
})

describe('buildEffectiveStrengths', () => {
	it('emits a row only for pairs the user connected', () => {
		const rows = buildEffectiveStrengths(
			[...bothWays('a', 'b', 0.8), ...bothWays('a', 'c', 0.6)],
			relations({ from: 'a', to: 'b' })
		)

		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ source: 'a', target: 'b', influence: 0.8, gravity: 1 })
	})

	it('is directional: an arrow one way produces no row the other way', () => {
		const rows = buildEffectiveStrengths(bothWays('a', 'b', 0.8), relations({ from: 'a', to: 'b' }))

		expect(rows.map((row) => `${row.source}->${row.target}`)).toEqual(['a->b'])
	})

	it('emits nothing when nothing is connected', () => {
		expect(buildEffectiveStrengths(bothWays('a', 'b', 0.9), {})).toEqual([])
	})

	it('keeps a row for a connected pair that is far out of range', () => {
		// MVP 0's most interesting state: "explicitly related despite distance".
		// Dropping it for having no proximity would hide the disagreement that makes
		// it informative.
		const rows = buildEffectiveStrengths(bothWays('a', 'b', 0), relations({ from: 'a', to: 'b' }))

		expect(rows).toHaveLength(1)
		expect(rows[0].influence).toBe(0)
		expect(rows[0].gravity).toBe(1)
		expect(rows[0].effectiveStrength).toBe(0.75)
	})

	it('records which strategy produced the number', () => {
		const rows = buildEffectiveStrengths(
			bothWays('a', 'b', 0.4),
			relations({ from: 'a', to: 'b' }),
			PRODUCT
		)

		expect(rows[0].strategy).toBe('product')
		expect(rows[0].effectiveStrength).toBe(0.4)
	})

	it('is reproducible from the row itself', () => {
		// The auditability property: a reader with only the JSON can recompute the
		// combination from the two numbers printed beside it. That only holds because
		// the row is combined from the *rounded* influence, not a hidden exact one.
		const rows = buildEffectiveStrengths(
			bothWays('a', 'b', 0.333),
			relations({ from: 'a', to: 'b', gravity: 0.4 })
		)
		const row = rows[0]

		expect(row.effectiveStrength).toBe(
			Math.round(STRATEGIES[row.strategy].combine(row.influence, row.gravity) * 1000) / 1000
		)
	})

	it('names the relations that produced the gravity', () => {
		const rows = buildEffectiveStrengths(
			bothWays('a', 'b', 0.5),
			relations({ id: 'r-two', from: 'a', to: 'b' }, { id: 'r-one', from: 'a', to: 'b' })
		)

		// Sorted, so provenance does not depend on relation iteration order.
		expect(rows[0].relations).toEqual(['r-one', 'r-two'])
	})

	describe('two arrows on one directed pair', () => {
		it('sums their gravities: saying it twice cannot mean it less', () => {
			const rows = buildEffectiveStrengths(
				bothWays('a', 'b', 0),
				relations({ from: 'a', to: 'b', gravity: 0.3 }, { from: 'a', to: 'b', gravity: 0.5 })
			)

			expect(rows).toHaveLength(1)
			expect(rows[0].gravity).toBe(0.8)
		})

		it('clamps the sum rather than exceeding the strongest claim available', () => {
			const rows = buildEffectiveStrengths(
				bothWays('a', 'b', 0),
				relations({ from: 'a', to: 'b', gravity: 0.8 }, { from: 'a', to: 'b', gravity: 0.9 })
			)

			expect(rows[0].gravity).toBe(1)
		})

		it('does not let a hesitant second arrow weaken a confident first', () => {
			const confident = buildEffectiveStrengths(
				bothWays('a', 'b', 0),
				relations({ from: 'a', to: 'b', gravity: 1 })
			)
			const alsoHesitant = buildEffectiveStrengths(
				bothWays('a', 'b', 0),
				relations({ from: 'a', to: 'b', gravity: 1 }, { from: 'a', to: 'b', gravity: 0.2 })
			)

			expect(alsoHesitant[0].gravity).toBeGreaterThanOrEqual(confident[0].gravity)
		})
	})

	describe('relations that cannot form a pair', () => {
		it('skips one whose endpoints have no influence row', () => {
			// An endpoint that is not a node in this document. `getCanvasRelations`
			// already prevents it, but an imported document is typed by assertion only.
			expect(
				buildEffectiveStrengths(bothWays('a', 'b', 0.5), relations({ from: 'a', to: 'ghost' }))
			).toEqual([])
		})

		it('skips a self-relation, following the influences that omit self-pairs', () => {
			expect(
				buildEffectiveStrengths(bothWays('a', 'b', 0.5), relations({ from: 'a', to: 'a' }))
			).toEqual([])
		})
	})

	describe('reading an untrusted gravity', () => {
		it('clamps a gravity above the scale', () => {
			const rows = buildEffectiveStrengths(bothWays('a', 'b', 0), {
				r1: { id: 'r1', from: 'a', to: 'b', gravity: 7 },
			})

			expect(rows[0].gravity).toBe(1)
		})

		it('keeps a deliberate zero rather than defaulting it', () => {
			// "Connected, but the user says barely" is a claim, and scrubbing it back to
			// the default would silently overrule them.
			const rows = buildEffectiveStrengths(bothWays('a', 'b', 0.4), {
				r1: { id: 'r1', from: 'a', to: 'b', gravity: 0 },
			})

			expect(rows[0].gravity).toBe(0)
			expect(rows[0].effectiveStrength).toBe(0.1)
		})
	})

	it('orders the strongest interactions first', () => {
		const rows = buildEffectiveStrengths(
			[...bothWays('a', 'b', 0.2), ...bothWays('a', 'c', 0.9), ...bothWays('b', 'c', 0.5)],
			relations(
				{ from: 'a', to: 'b' },
				{ from: 'a', to: 'c' },
				{ from: 'b', to: 'c', gravity: 0.1 }
			)
		)

		expect(rows.map((row) => `${row.source}->${row.target}`)).toEqual(['a->c', 'a->b', 'b->c'])
	})

	it('never exceeds the 0-1 contract, whatever the strategy returns', () => {
		const overshooting = { name: 'lift' as const, combine: () => 4 }
		const undershooting = { name: 'lift' as const, combine: () => -4 }
		const nonsense = { name: 'lift' as const, combine: () => NaN }

		const strength = (strategy: { name: 'lift'; combine: () => number }) =>
			buildEffectiveStrengths(
				bothWays('a', 'b', 0.5),
				relations({ from: 'a', to: 'b' }),
				strategy
			)[0].effectiveStrength

		expect(strength(overshooting)).toBe(1)
		expect(strength(undershooting)).toBe(0)
		expect(strength(nonsense)).toBe(0)
	})

	it('derives without mutating its inputs', () => {
		const influences = bothWays('a', 'b', 0.5)
		const record = relations({ from: 'a', to: 'b' })
		const before = JSON.parse(JSON.stringify({ influences, record }))

		buildEffectiveStrengths(influences, record)

		expect(JSON.parse(JSON.stringify({ influences, record }))).toEqual(before)
	})
})
