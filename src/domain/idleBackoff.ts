/**
 * How long to let the canvas fall quiet before asking the model anything.
 *
 * `EPISODE_IDLE_MS` is a guess about one user's rhythm applied to every user. Guess short
 * and a pause mid-arrangement is read as the end of a gesture: a thought starts, the user
 * comes back, and the answer it eventually produces is about a canvas that has moved on.
 * Guess long and the companion says nothing worth hearing because it hears nothing.
 *
 * So the pause is not a constant but a number that moves, and this is the policy for
 * moving it. The insight it rests on: when a thought is killed we know *exactly* how long
 * the quiet was that fooled us — what the recorder waited out, plus how long the user
 * stayed away after it fired. Waiting a little past that would not have fired. So one
 * penalty can land past the real rhythm instead of geometrically groping towards it.
 *
 * The ceiling is low and the decay is fast on purpose. The pipeline behind a remark is
 * about 4.7s of model call and synthesis, so the total quiet a remark needs to land is the
 * pause plus that: 5.9s at the base, 8.7s at the cap. Much beyond the cap and the
 * companion would escalate itself into permanent silence — which is why an interruption
 * only ever raises the pause one considered step, and a single clean round trip halves the
 * way back down.
 *
 * Pure and clockless. It is handed the measured quiet; it never reads a clock or a canvas,
 * so the whole policy is arithmetic and its tests are arithmetic.
 */
import { EPISODE_IDLE_MS } from '@/domain/episode'

/**
 * The least an interruption may raise the pause.
 *
 * Without it, a user who resumes the instant an episode closes would only ever move the
 * pause by the margin, and a fidget would cost a dozen model calls to settle.
 */
export const IDLE_BACKOFF_STEP_MS = 600

/** How far past the pause that fooled us to land, so the same rhythm doesn't fire again. */
export const IDLE_BACKOFF_MARGIN_MS = 400

/**
 * The longest pause the policy will ever ask for.
 *
 * At 4s a remark needs ~8.7s of unbroken quiet to reach the user, which is already past
 * most pauses in real arranging. Higher would trade a rare stale remark for a companion
 * that never speaks.
 */
export const IDLE_BACKOFF_CAP_MS = 4_000

/**
 * How close to the base counts as being at it.
 *
 * Halving an excess approaches zero without reaching it, so without a snap the pause would
 * sit a few milliseconds above the base forever and never read as "back to normal".
 */
const SNAP_MS = 100

export interface IdleBackoffOptions {
	/** The pause to rest at. Defaults to `EPISODE_IDLE_MS`. */
	baseMs?: number
	stepMs?: number
	marginMs?: number
	capMs?: number
}

export interface IdleBackoff {
	/** The pause the recorder should currently wait out. */
	currentMs(): number
	/**
	 * A thought was killed after `quietForMs` of quiet — that much was demonstrably not
	 * enough. Raise the pause past it, by at least a step, never past the cap.
	 */
	interrupted(quietForMs: number): void
	/** A thought completed without interruption. Ease the pause back toward the base. */
	settled(): void
}

export function createIdleBackoff({
	baseMs = EPISODE_IDLE_MS,
	stepMs = IDLE_BACKOFF_STEP_MS,
	marginMs = IDLE_BACKOFF_MARGIN_MS,
	capMs = IDLE_BACKOFF_CAP_MS,
}: IdleBackoffOptions = {}): IdleBackoff {
	let current = baseMs

	return {
		currentMs: () => current,

		interrupted(quietForMs) {
			// The margin is what lands past the measured rhythm; the step is what guarantees
			// progress when that rhythm was barely longer than the pause we already had. The
			// cap makes repeated interruption idempotent once the ceiling is reached.
			current = Math.min(capMs, Math.max(current + stepMs, quietForMs + marginMs))
		},

		settled() {
			// Half the way back rather than a reset: a user who alternates between arranging
			// in bursts and pausing to think shouldn't send the pause ping-ponging between
			// the cap and the base, re-earning the same penalty every other gesture.
			const excess = current - baseMs
			current = excess <= SNAP_MS ? baseMs : baseMs + excess / 2
		},
	}
}
