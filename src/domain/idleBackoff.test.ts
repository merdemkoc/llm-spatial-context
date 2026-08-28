/**
 * The pacing policy: how the idle pause moves when thoughts are killed and when they land.
 *
 * Pure and clockless, so every case here is arithmetic — which is the point of keeping it
 * out of the orchestrator. The behaviours that matter are that a penalty always lands
 * *past* the pause that fooled us, that repeated fidgeting still makes progress, that the
 * ceiling holds, and that a clean round trip walks the pause back down.
 */
import { describe, expect, it } from 'vitest'
import { EPISODE_IDLE_MS } from '@/domain/episode'
import {
	createIdleBackoff,
	IDLE_BACKOFF_CAP_MS,
	IDLE_BACKOFF_MARGIN_MS,
	IDLE_BACKOFF_STEP_MS,
} from '@/domain/idleBackoff'

describe('createIdleBackoff', () => {
	it('starts at the base pause', () => {
		expect(createIdleBackoff().currentMs()).toBe(EPISODE_IDLE_MS)
	})

	it('jumps past the pause that fooled it', () => {
		const backoff = createIdleBackoff()

		// The episode closed after 1.2s of quiet and the user came back 1.3s later, so 2.5s
		// of quiet was not enough. Anything at or below that would fire again in the same spot.
		backoff.interrupted(2500)

		expect(backoff.currentMs()).toBe(2500 + IDLE_BACKOFF_MARGIN_MS)
	})

	it('makes progress even when the user came straight back', () => {
		const backoff = createIdleBackoff()

		// A resume 50ms after the episode closed puts the fooling pause barely above the
		// current one, so the margin alone would inch forward. The step is what stops a
		// fidget from taking a dozen model calls to settle.
		backoff.interrupted(EPISODE_IDLE_MS + 50)

		expect(backoff.currentMs()).toBe(EPISODE_IDLE_MS + IDLE_BACKOFF_STEP_MS)
	})

	it('holds at the ceiling however often it is interrupted', () => {
		const backoff = createIdleBackoff()

		for (let i = 0; i < 20; i += 1) backoff.interrupted(backoff.currentMs() + 100)

		expect(backoff.currentMs()).toBe(IDLE_BACKOFF_CAP_MS)
	})

	it('never returns a pause past the ceiling, even for one enormous gap', () => {
		const backoff = createIdleBackoff()

		backoff.interrupted(60_000)

		expect(backoff.currentMs()).toBe(IDLE_BACKOFF_CAP_MS)
	})

	it('halves the excess when a thought lands uninterrupted', () => {
		const backoff = createIdleBackoff({ baseMs: 1000, capMs: 5000 })

		backoff.interrupted(3600) // → 4000, an excess of 3000 over the base
		backoff.settled()

		expect(backoff.currentMs()).toBe(2500)
	})

	it('returns to the base rather than converging on it forever', () => {
		const backoff = createIdleBackoff()

		backoff.interrupted(3000)
		for (let i = 0; i < 10; i += 1) backoff.settled()

		expect(backoff.currentMs()).toBe(EPISODE_IDLE_MS)
	})

	it('is unmoved by settling at the base', () => {
		const backoff = createIdleBackoff()

		backoff.settled()

		expect(backoff.currentMs()).toBe(EPISODE_IDLE_MS)
	})
})
