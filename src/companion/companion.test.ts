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
	const voice: VoiceClient = {
		speak: async (text) => {
			spoken.push(text)
		},
	}
	return { voice, spoken }
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
})
