// @vitest-environment jsdom
/**
 * The companion orchestrator: episode → gate → think → comment → speak.
 *
 * Drives the loop through a real recorder with an injected clock and fake observer/voice
 * clients, so every branch — silence, voice-off, observation-off, interruption,
 * anti-repetition — is exercised with no network and no real timers.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createEventStream, type Schedule, type SpatialEvent } from '@/domain'
import { createCompanion } from '@/companion/companion'
import type { ObserveRequest, ObserverClient, ObserverDecision } from '@/companion/observerClient'
import type { VoiceClient } from '@/companion/voiceClient'
import {
	companionThinking,
	companionTranscript,
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

function controllableSchedule() {
	let pending: (() => void) | null = null
	const schedule: Schedule = (fn) => {
		pending = fn
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

function fakeVoice() {
	const spoken: string[] = []
	let stopped = 0
	const voice: VoiceClient = {
		speak: async (text) => {
			spoken.push(text)
		},
		stop: () => {
			stopped += 1
		},
	}
	return {
		voice,
		spoken,
		get stopped() {
			return stopped
		},
	}
}

/** Let all pending microtasks (awaited promises) settle. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	observationEnabled.set(true)
	voiceEnabled.set(true)
	companionThinking.set(false)
	companionTranscript.set([])
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
		expect(companionThinking.get()).toBe(true)

		calls[0].resolve({ speak: true, comment: 'Those two are converging.' })
		await tick()

		expect(spoken).toEqual(['Those two are converging.'])
		expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
			'Those two are converging.',
		])
		expect(companionThinking.get()).toBe(false)
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
		expect(companionThinking.get()).toBe(false)
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
		expect(companionThinking.get()).toBe(false)
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
		expect(companionThinking.get()).toBe(false)
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
		expect(companionThinking.get()).toBe(true)

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
		expect(companionThinking.get()).toBe(false)
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
		expect(companionThinking.get()).toBe(false)
	})

	it('stops speaking and clears the indicator when disposed', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const voiceFake = fakeVoice()
		const dispose = createCompanion({
			stream,
			observer,
			voice: voiceFake.voice,
			schedule: timer.schedule,
		})

		stream.emit([meaningful()])
		timer.flush()
		dispose()
		// An answer that arrives after teardown must not reach a companion that is gone.
		calls[0].resolve({ speak: true, comment: 'nobody is listening' })
		await tick()

		expect(voiceFake.spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		expect(companionThinking.get()).toBe(false)
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
})
