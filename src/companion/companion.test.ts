// @vitest-environment jsdom
/**
 * The companion orchestrator: episode → gate → think → comment → speak.
 *
 * Drives the loop through a real recorder with an injected clock and fake observer/voice
 * clients, so every branch — silence, voice-off, observation-off, interruption,
 * anti-repetition — is exercised with no network and no real timers.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
	createEventStream,
	EPISODE_IDLE_MS,
	IDLE_BACKOFF_CAP_MS,
	IDLE_BACKOFF_MARGIN_MS,
	type BoardSummary,
	type Schedule,
	type SpatialEvent,
} from '@/domain'
import { createCompanion } from '@/companion/companion'
import type { ObserveRequest, ObserverClient, ObserverDecision } from '@/companion/observerClient'
import type { GroupingProposal, SuggestClient, SuggestRequest } from '@/companion/suggestClient'
import type { VoiceClient } from '@/companion/voiceClient'
import {
	companionPacing,
	companionStage,
	companionTranscript,
	companionUtterance,
	groupingSuggestion,
	observationEnabled,
	voiceEnabled,
} from '@/companion/companionState'

const influence = (
	source: string,
	target: string,
	before: number,
	after: number
): SpatialEvent => ({
	type: 'influence_changed',
	source,
	target,
	previous: { influence: before },
	current: { influence: after },
})

const meaningful = () => influence('a', 'b', 0.04, 0.58)
const trivial = () => influence('a', 'b', 0.36, 0.39)

const moved = (nodeId: string): SpatialEvent => ({
	type: 'node_moved',
	nodeId,
	previous: { x: 0, y: 0 },
	current: { x: 10, y: 10 },
})

function controllableSchedule() {
	let pending: (() => void) | null = null
	let lastMs = 0
	const schedule: Schedule = (fn, ms) => {
		pending = fn
		lastMs = ms
		return () => {
			if (pending === fn) pending = null
		}
	}
	return {
		schedule,
		flush: () => {
			const fn = pending
			pending = null
			fn?.()
		},
		/** The pause the recorder last armed — the adaptive one, once it starts moving. */
		get lastMs() {
			return lastMs
		},
	}
}

/**
 * A clock the test advances by hand.
 *
 * The pacing policy is fed a *measured* quiet — how long the recorder waited plus how long
 * the user stayed away after it fired — so a test that cannot move the clock cannot say
 * what the policy should have concluded.
 */
function controllableClock() {
	let at = 0
	return {
		now: () => at,
		advance: (ms: number) => {
			at += ms
		},
	}
}

function fakeObserver() {
	const calls: {
		request: ObserveRequest
		signal?: AbortSignal
		resolve: (decision: ObserverDecision) => void
	}[] = []
	const observer: ObserverClient = {
		observe(request, signal) {
			return new Promise<ObserverDecision>((resolve) => {
				calls.push({ request, signal, resolve })
			})
		},
	}
	return { observer, calls }
}

/**
 * A voice that reports playback the way the real client does.
 *
 * By default it starts speaking the moment it is asked, which is what the orchestration
 * tests want. `{ manual: true }` withholds that: synthesis takes a second or three in
 * reality, and the tests about *when* the words appear need to sit inside that gap, so they
 * drive `start()` and `progress()` themselves.
 */
function fakeVoice({ manual = false }: { manual?: boolean } = {}) {
	const spoken: string[] = []
	let stopped = 0

	const plays: { text: string; start: () => void; progress: (fraction: number) => void }[] = []

	const voice: VoiceClient = {
		speak: async (text, options) => {
			spoken.push(text)
			plays.push({
				text,
				start: () => options?.onStart?.(),
				progress: (fraction) => options?.onProgress?.(fraction),
			})
			if (!manual) options?.onStart?.()
		},
		stop: () => {
			stopped += 1
		},
	}

	return {
		voice,
		spoken,
		plays,
		get stopped() {
			return stopped
		},
	}
}

/** A voice whose synthesis fails — a blocked autoplay, a dead TTS route. */
function brokenVoice() {
	let stopped = 0
	const voice: VoiceClient = {
		speak: async () => {
			throw new Error('speak failed: 500')
		},
		stop: () => {
			stopped += 1
		},
	}
	return {
		voice,
		get stopped() {
			return stopped
		},
	}
}

/** A suggester whose proposals resolve on the test's command, like the fake observer. */
function fakeSuggester() {
	const calls: {
		request: SuggestRequest
		signal?: AbortSignal
		resolve: (proposal: GroupingProposal) => void
	}[] = []
	const client: SuggestClient = {
		suggest(request, signal) {
			return new Promise<GroupingProposal>((resolve) => {
				calls.push({ request, signal, resolve })
			})
		},
	}
	return { client, calls }
}

/** A board with three lone ideas — enough to warrant a proactive grouping. */
const scatteredBoard: BoardSummary = {
	nodeCount: 3,
	nodes: [
		{ id: 'a', text: 'one', hasField: false },
		{ id: 'b', text: 'two', hasField: false },
		{ id: 'c', text: 'three', hasField: false },
	],
	clusters: [],
	loners: ['a', 'b', 'c'],
	proximities: [],
	relations: [],
	effectiveStrengths: [],
	truncated: false,
}

/** A plan builder that just lines the members up — enough for the loop tests. */
const linePlan = (ids: string[]) => ({ members: ids, targets: ids.map((id, i) => ({ id, x: i * 10, y: 0 })) })

/** Let all pending microtasks (awaited promises) settle. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	observationEnabled.set(true)
	voiceEnabled.set(true)
	companionStage.set('idle')
	companionTranscript.set([])
	companionUtterance.set(null)
	companionPacing.set({ idleMs: EPISODE_IDLE_MS, dropped: 0 })
	groupingSuggestion.set(null)
})

describe('createCompanion', () => {
	it('consults the observer for a meaningful episode and speaks the comment', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()

		expect(calls).toHaveLength(1)
		expect(companionStage.get()).not.toBe('idle')

		calls[0].resolve({ speak: true, comment: 'Those two are converging.' })
		await tick()

		expect(spoken).toEqual(['Those two are converging.'])
		expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
			'Those two are converging.',
		])
		expect(companionStage.get()).toBe('idle')
	})

	it('drops a trivial episode without consulting the observer', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([trivial()])
		timer.flush()

		expect(calls).toHaveLength(0)
		expect(companionStage.get()).toBe('idle')
	})

	it('stays silent when the observer declines', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		calls[0].resolve({ speak: false, comment: null })
		await tick()

		expect(spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		expect(companionStage.get()).toBe('idle')
	})

	it('fills the transcript but does not speak when voice is off', async () => {
		voiceEnabled.set(false)
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		calls[0].resolve({ speak: true, comment: 'Still worth noting.' })
		await tick()

		expect(spoken).toEqual([])
		expect(companionTranscript.get().map((entry) => entry.comment)).toEqual(['Still worth noting.'])
	})

	it('does not consult the observer when observation is off', () => {
		observationEnabled.set(false)
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()

		expect(calls).toHaveLength(0)
		expect(companionStage.get()).toBe('idle')
	})

	it('aborts an in-flight observation when a new episode arrives', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		stream.emit([influence('c', 'd', 0.1, 0.7)])
		timer.flush()

		expect(calls).toHaveLength(2)
		expect(calls[0].signal?.aborted).toBe(true)
		expect(calls[1].signal?.aborted).toBe(false)
	})

	it('passes recent comments to the observer so it can avoid repeating itself', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		calls[0].resolve({ speak: true, comment: 'first observation' })
		await tick()

		stream.emit([influence('c', 'd', 0.1, 0.7)])
		timer.flush()

		expect(calls[1].request.recentComments).toEqual(['first observation'])
	})

	// The abort assertion alone passes even with the generation guard deleted, because a
	// fake observer can ignore the signal — as a real one can, having already sent the
	// request. This resolves the *superseded* call and proves its answer is discarded.
	it('discards a superseded answer even if the abort is ignored', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		stream.emit([influence('c', 'd', 0.1, 0.7)])
		timer.flush()

		// The stale call answers late, after the fresh episode already owns the loop.
		calls[0].resolve({ speak: true, comment: 'about a canvas that has moved on' })
		await tick()

		expect(spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		// The fresh episode still owns the indicator and can still speak.
		expect(companionStage.get()).not.toBe('idle')

		calls[1].resolve({ speak: true, comment: 'about the canvas as it is now' })
		await tick()

		expect(spoken).toEqual(['about the canvas as it is now'])
	})

	it('keeps quiet when observation is switched off while it is thinking', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		observationEnabled.set(false)
		calls[0].resolve({ speak: true, comment: 'too late to say this' })
		await tick()

		expect(spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		expect(companionStage.get()).toBe('idle')
	})

	it('says nothing when the observer fails, and stops thinking', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { voice, spoken } = fakeVoice()
		const observer: ObserverClient = { observe: () => Promise.reject(new Error('502')) }
		createCompanion({ stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		await tick()

		expect(spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		expect(companionStage.get()).toBe('idle')
	})

	it('stops speaking and clears the indicator when disposed', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const voiceFake = fakeVoice()
		const companion = createCompanion({
			stream,
			observer,
			voice: voiceFake.voice,
			schedule: timer.schedule,
		})

		stream.emit([meaningful()])
		timer.flush()
		companion.dispose()
		// An answer that arrives after teardown must not reach a companion that is gone.
		calls[0].resolve({ speak: true, comment: 'nobody is listening' })
		await tick()

		expect(voiceFake.spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		expect(companionStage.get()).toBe('idle')
		expect(voiceFake.stopped).toBeGreaterThan(0)
	})

	it('passes only the last few comments, not the whole transcript', async () => {
		companionTranscript.set([
			{ comment: 'one', at: 1 },
			{ comment: 'two', at: 2 },
			{ comment: 'three', at: 3 },
			{ comment: 'four', at: 4 },
		])
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ stream, observer, voice, schedule: timer.schedule, historySize: 2 })

		stream.emit([meaningful()])
		timer.flush()

		expect(calls[0].request.recentComments).toEqual(['three', 'four'])
	})

	it('hands the observer the whole-board summary for context', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		const board: BoardSummary = {
			nodeCount: 2,
			nodes: [
				{ id: 'a', text: 'pricing', hasField: false },
				{ id: 'b', text: 'onboarding', hasField: false },
			],
			clusters: [{ members: ['a', 'b'] }],
			loners: [],
			proximities: [{ source: 'a', target: 'b', influence: 0.8 }],
			relations: [],
			effectiveStrengths: [],
			truncated: false,
		}
		createCompanion({ stream, observer, voice, schedule: timer.schedule, board: () => board })

		stream.emit([meaningful()])
		timer.flush()

		expect(calls[0].request.board).toEqual(board)
	})

	it('tells the observer what the ids mean', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({
			stream,
			observer,
			voice,
			schedule: timer.schedule,
			context: () => ({
				labels: { a: 'pricing', b: 'onboarding' },
				relations: [{ source: 'a', target: 'b', gravity: 1 }],
			}),
		})

		stream.emit([meaningful()])
		timer.flush()

		expect(calls[0].request.context.labels).toEqual({ a: 'pricing', b: 'onboarding' })
		expect(calls[0].request.context.relations).toHaveLength(1)
	})

	describe('grouping suggestions', () => {
		it('proposes a grouping when the observer stays silent and the board warrants it', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			const suggester = fakeSuggester()
			createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				suggest: suggester.client,
				planGrouping: linePlan,
				shouldProposeGrouping: () => true,
			})

			stream.emit([meaningful()])
			timer.flush()
			// The observer has nothing to say — the moment a grouping can step in.
			calls[0].resolve({ speak: false, comment: null })
			await tick()

			expect(suggester.calls).toHaveLength(1)
			expect(suggester.calls[0].request.trigger).toBe('proactive')

			suggester.calls[0].resolve({ members: ['a', 'b'], rationale: 'These two belong together.' })
			await tick()

			expect(groupingSuggestion.get()?.members).toEqual(['a', 'b'])
			expect(spoken).toEqual(['These two belong together.'])
			expect(companionTranscript.get().map((e) => e.comment)).toEqual([
				'These two belong together.',
			])
		})

		it('does not propose proactively when the observer spoke', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			const suggester = fakeSuggester()
			createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				suggest: suggester.client,
				planGrouping: linePlan,
				shouldProposeGrouping: () => true,
			})

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'A remark about the change.' })
			await tick()

			expect(suggester.calls).toHaveLength(0)
		})

		it('does not consult the observer while a grouping suggestion is pending', () => {
			groupingSuggestion.set({ generation: 1, members: ['a', 'b'], targets: [], rationale: 'x' })
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()

			expect(calls).toHaveLength(0)
		})

		it('proposes a grouping on demand, regardless of the proactive gates', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			const suggester = fakeSuggester()
			const companion = createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				suggest: suggester.client,
				planGrouping: linePlan,
				// The cooldown never elapses — on demand must ignore it.
				shouldProposeGrouping: () => false,
			})

			companion.requestGrouping()

			expect(suggester.calls).toHaveLength(1)
			expect(suggester.calls[0].request.trigger).toBe('demand')

			suggester.calls[0].resolve({ members: ['a', 'c'], rationale: 'On request.' })
			await tick()

			expect(groupingSuggestion.get()?.members).toEqual(['a', 'c'])
			expect(spoken).toEqual(['On request.'])
		})

		it('stays idle when the suggester declines', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			const suggester = fakeSuggester()
			const companion = createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				suggest: suggester.client,
				planGrouping: linePlan,
			})

			companion.requestGrouping()
			suggester.calls[0].resolve({ members: [], rationale: '' })
			await tick()

			expect(groupingSuggestion.get()).toBeNull()
			expect(spoken).toEqual([])
			expect(companionStage.get()).toBe('idle')
		})

		it('affirms an accepted grouping and does not narrate its own move', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			let applied = 0
			const companion = createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				applyGrouping: (plan) => {
					applied = plan.targets.length
					return applied
				},
			})

			groupingSuggestion.set({
				generation: 9,
				members: ['a', 'b', 'c'],
				targets: [
					{ id: 'a', x: 0, y: 0 },
					{ id: 'b', x: 10, y: 0 },
					{ id: 'c', x: 20, y: 0 },
				],
				rationale: 'These three belong together.',
			})

			companion.acceptGrouping()
			await tick()

			expect(applied).toBe(3)
			expect(groupingSuggestion.get()).toBeNull()
			expect(spoken).toEqual(['There — those three sit together now.'])

			// The repositioning finalizes as an episode moments later; it must be swallowed
			// rather than narrated or re-grouped.
			stream.emit([meaningful()])
			timer.flush()
			expect(calls).toHaveLength(0)
		})
	})

	describe('saying it and showing it together', () => {
		it('keeps thinking up through synthesis, then hands over to the voice', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'Those two are converging.' })
			await tick()

			// Mid-synthesis: the model has answered but nothing is audible yet, so the
			// remark must not be on screen — reading it now means reading it before, and
			// then again during, the sound.
			expect(companionStage.get()).not.toBe('idle')
			expect(companionUtterance.get()).toBeNull()
			// It is in the transcript already, because that is the record of the decision.
			expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
				'Those two are converging.',
			])

			plays[0].start()

			expect(companionStage.get()).toBe('idle')
			expect(companionUtterance.get()).toEqual({
				comment: 'Those two are converging.',
				fraction: 0,
			})
		})

		it('follows playback, and lets go of the utterance when the clip ends', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'Those two are converging.' })
			await tick()
			plays[0].start()

			plays[0].progress(0.5)
			expect(companionUtterance.get()?.fraction).toBe(0.5)

			// At the end the bar falls back to the transcript's newest entry, which is the
			// same sentence in full — so nothing is left half-revealed on screen.
			plays[0].progress(1)
			expect(companionUtterance.get()).toBeNull()
		})

		it('shows the remark at once when voice is off — there is nothing to wait for', async () => {
			voiceEnabled.set(false)
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice({ manual: true })
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'Still worth noting.' })
			await tick()

			expect(companionStage.get()).toBe('idle')
			expect(companionUtterance.get()).toBeNull()
			expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
				'Still worth noting.',
			])
		})

		it('does not strand the hint when playback fails', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = brokenVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'Nobody will hear this.' })
			await tick()

			// A dead TTS route must not leave "thinking" up forever, and the observation
			// still has to be readable.
			expect(companionStage.get()).toBe('idle')
			expect(companionUtterance.get()).toBeNull()
			expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
				'Nobody will hear this.',
			])
		})

		it('stops the clip a newer remark supersedes', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const voiceFake = fakeVoice({ manual: true })
			createCompanion({
				stream,
				observer,
				voice: voiceFake.voice,
				schedule: timer.schedule,
			})

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'The first remark.' })
			await tick()
			voiceFake.plays[0].start()

			// A newer episode takes over. Clearing the text is not enough: without stopping
			// the audio the old clip carries on talking with nothing on screen behind it.
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			timer.flush()

			// Exactly once, and only because something was playing: a `stop()` on every
			// episode would make this assertion pass without the behaviour existing.
			expect(voiceFake.stopped).toBe(1)
		})

		it('ignores progress from a clip a newer episode has superseded', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'The first remark.' })
			await tick()
			plays[0].start()

			// A newer episode takes over while the first clip is still playing.
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			timer.flush()
			expect(companionStage.get()).not.toBe('idle')

			// The old clip's frames keep arriving until its audio is released. They must
			// not put a stale sentence back on screen over the new thought.
			plays[0].progress(0.9)

			expect(companionUtterance.get()).toBeNull()
			expect(companionStage.get()).not.toBe('idle')
		})
	})

	/**
	 * The pause before a thought starts is a guess about the user's rhythm, and the ~4.7s
	 * of model call and synthesis behind it is time the canvas can change out from under
	 * the answer. These are the two halves of the response: kill the thought the moment
	 * the user is back, and let the guess learn from having been wrong.
	 */
	describe('pacing itself against the user', () => {
		it('drops the thought the moment the user comes back, not when the next episode closes', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			expect(companionStage.get()).toBe('observing')

			// One event, no flush: the next episode is still being buffered. The old code
			// waited for it to close before aborting, which left a stale answer free to
			// arrive and be spoken over the gesture in progress.
			stream.emit([influence('c', 'd', 0.1, 0.7)])

			expect(calls[0].signal?.aborted).toBe(true)
			expect(companionStage.get()).toBe('idle')
		})

		it('discards an answer that arrives after the user came back', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			stream.emit([influence('c', 'd', 0.1, 0.7)])

			// The real observer may well have sent the request already and answer anyway.
			calls[0].resolve({ speak: true, comment: 'about a canvas that has moved on' })
			await tick()

			expect(spoken).toEqual([])
			expect(companionTranscript.get()).toEqual([])
			expect(companionStage.get()).toBe('idle')
		})

		it('abandons a remark whose voice has not arrived yet, but keeps the record of it', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'A remark nobody will hear.' })
			await tick()
			expect(companionStage.get()).toBe('composing')

			stream.emit([influence('c', 'd', 0.1, 0.7)])

			expect(companionStage.get()).toBe('idle')

			// Synthesis finishing after the fact must not put the sentence on screen: the
			// canvas it described is gone. The transcript still has it, because that is the
			// record of what the companion decided, not of what it managed to say.
			plays[0].start()

			expect(companionUtterance.get()).toBeNull()
			expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
				'A remark nobody will hear.',
			])
		})

		it('leaves a remark it has already begun speaking alone', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const voiceFake = fakeVoice({ manual: true })
			createCompanion({
				stream,
				observer,
				voice: voiceFake.voice,
				schedule: timer.schedule,
			})

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'Halfway through this one.' })
			await tick()
			voiceFake.plays[0].start()

			// Touching the board mid-sentence is not a reason to cut a sentence off mid-word.
			// It has been decided and it is half-heard; the remark rides it out.
			stream.emit([influence('c', 'd', 0.1, 0.7)])

			expect(voiceFake.stopped).toBe(0)
			expect(companionUtterance.get()?.comment).toBe('Halfway through this one.')
			expect(companionPacing.get().dropped).toBe(0)
		})

		it('carries the killed gesture forward, so the next remark describes the whole arc', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([influence('a', 'b', 0.04, 0.58)])
			timer.flush()
			// The user resumes, killing that thought and pushing the pair further.
			stream.emit([influence('a', 'b', 0.58, 0.9)])
			timer.flush()

			// Not 0.58. The interrupted episode held the arc's starting point, and losing it
			// would leave the observer describing the tail of a gesture as if it were all of it.
			expect(calls[1].request.episode.pairs).toEqual([
				{
					source: 'a',
					target: 'b',
					before: { influence: 0.04 },
					after: { influence: 0.9 },
					transitions: ['influence_changed'],
				},
			])
		})

		it('keeps an open arc whole when the episode it merges into reads as trivial', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			stream.emit([influence('a', 'b', 0.04, 0.58)])
			timer.flush()

			// The user comes back and undoes most of it, taking a node with them. Merged with
			// the killed episode this nets out to almost nothing, so the local gate drops it —
			// but dropping the *episode* must not drop the arc, or the move rides along in
			// nothing and the eventual remark describes a canvas that never existed.
			stream.emit([influence('a', 'b', 0.58, 0.06), moved('z')])
			timer.flush()
			expect(calls).toHaveLength(1)

			stream.emit([influence('a', 'b', 0.06, 0.7)])
			timer.flush()

			expect(calls).toHaveLength(2)
			expect(calls[1].request.episode.structural).toEqual([moved('z')])
			expect(calls[1].request.episode.pairs[0].before).toEqual({ influence: 0.04 })
		})

		it('stretches the pause past the rhythm that fooled it, then eases back', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule, now: clock.now })

			stream.emit([meaningful()])
			expect(timer.lastMs).toBe(EPISODE_IDLE_MS)

			// The episode closes on schedule, and the user comes back half a second later —
			// so 1.7s of quiet was not the end of anything.
			clock.advance(EPISODE_IDLE_MS)
			timer.flush()
			clock.advance(500)
			stream.emit([influence('c', 'd', 0.1, 0.7)])

			// Past the 1.7s that fooled it, by the margin — and armed for the gesture in
			// progress, not merely for the one after it.
			const stretched = EPISODE_IDLE_MS + 500 + IDLE_BACKOFF_MARGIN_MS
			expect(companionPacing.get()).toEqual({ idleMs: stretched, dropped: 1 })
			expect(timer.lastMs).toBe(stretched)

			// This one lands: the longer pause was long enough, so half the penalty is
			// handed back rather than the companion staying cautious for the whole session.
			timer.flush()
			calls[1].resolve({ speak: true, comment: 'This one lands.' })
			await tick()

			expect(companionPacing.get().idleMs).toBe(EPISODE_IDLE_MS + (stretched - EPISODE_IDLE_MS) / 2)
		})

		it('never stretches past the ceiling', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule, now: clock.now })

			// A user arranging in bursts, interrupting every thought.
			for (let i = 0; i < 12; i += 1) {
				clock.advance(timer.lastMs)
				timer.flush()
				clock.advance(300)
				stream.emit([influence('a', 'b', 0.04 + i / 100, 0.58 + i / 100)])
			}

			expect(companionPacing.get().idleMs).toBe(IDLE_BACKOFF_CAP_MS)
			expect(timer.lastMs).toBe(IDLE_BACKOFF_CAP_MS)
		})

		it('does not penalise a pause no thought was waiting on', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ stream, observer, voice, schedule: timer.schedule })

			// The local gate dropped this one, so nothing was in flight to interrupt and the
			// pause was never shown to be too short.
			stream.emit([trivial()])
			timer.flush()
			stream.emit([trivial()])

			expect(companionPacing.get()).toEqual({ idleMs: EPISODE_IDLE_MS, dropped: 0 })
		})

		it('resets the pacing readout on teardown', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer } = fakeObserver()
			const { voice } = fakeVoice()
			const dispose = createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				now: clock.now,
			})

			stream.emit([meaningful()])
			clock.advance(EPISODE_IDLE_MS)
			timer.flush()
			clock.advance(500)
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			expect(companionPacing.get().dropped).toBe(1)

			// A StrictMode remount must not inherit the last mount's rhythm.
			dispose()

			expect(companionPacing.get()).toEqual({ idleMs: EPISODE_IDLE_MS, dropped: 0 })
		})
	})
})
