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
import {
	HEAD_OF_LINE_MS,
	MAX_REMARK_AGE_MS,
	MIN_DWELL_MS,
	pairKey,
	QUEUE_LIMIT,
	type EpisodeValidity,
} from '@/companion/thoughtQueue'
import type { ObserveRequest, ObserverClient, ObserverDecision } from '@/companion/observerClient'
import type { GroupingProposal, SuggestClient, SuggestRequest } from '@/companion/suggestClient'
import type { Reflection, ReflectClient, ReflectRequest } from '@/companion/reflectClient'
import type { VoiceClient } from '@/companion/voiceClient'
import { EMPTY_UNDERSTANDING } from '@/companion/digestClient'
import type { BoardUnderstanding, DigestClient, DigestRequest } from '@/companion/digestClient'
import {
	boardUnderstanding,
	companionFocus,
	companionPacing,
	companionQueue,
	companionStage,
	companionTranscript,
	companionUtterance,
	groupingSuggestion,
	ideaSuggestions,
	observationEnabled,
	relationSuggestions,
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

	const plays: {
		text: string
		start: () => void
		progress: (fraction: number) => void
		/** The clip is over — what the real client reports from `ended`, `error` or a `stop()`. */
		finish: () => void
	}[] = []

	const voice: VoiceClient = {
		speak: async (text, options) => {
			spoken.push(text)
			let ended = false
			const finish = () => {
				if (ended) return
				ended = true
				options?.onEnd?.()
			}
			plays.push({
				text,
				start: () => options?.onStart?.(),
				progress: (fraction) => options?.onProgress?.(fraction),
				finish,
			})
			if (!manual) {
				// Starts and finishes in the same breath. The queue is paced by the ending, so a
				// fake that never reported one would leave every test after the first remark
				// waiting on a clip that had already, as far as anything can tell, stopped.
				options?.onStart?.()
				finish()
			}
		},
		stop: () => {
			stopped += 1
			for (const play of plays) play.finish()
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
		speak: async (_text, options) => {
			// The real client reports the ending even for a synthesis that never happened; a
			// fake that only threw would be a fake the pump could deadlock on.
			options?.onEnd?.()
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
const linePlan = (ids: string[]) => ({
	members: ids,
	targets: ids.map((id, i) => ({ id, x: i * 10, y: 0 })),
})

/** A reflecter whose answers resolve on the test's command. */
function fakeReflecter() {
	const calls: {
		request: ReflectRequest
		signal?: AbortSignal
		resolve: (reflection: Reflection) => void
	}[] = []
	const client: ReflectClient = {
		reflect(request, signal) {
			return new Promise<Reflection>((resolve) => {
				calls.push({ request, signal, resolve })
			})
		},
	}
	return { client, calls }
}

/** A digest whose answer the test resolves. Nothing waits on it, but tests need its timing. */
function fakeDigester() {
	const calls: {
		request: DigestRequest
		resolve: (understanding: BoardUnderstanding) => void
		reject: (error: Error) => void
	}[] = []
	const client: DigestClient = {
		digest(request) {
			return new Promise<BoardUnderstanding>((resolve, reject) => {
				calls.push({ request, resolve, reject })
			})
		},
	}
	return { client, calls }
}

/** Turn proposals into ghost ideas the way the adapter would — index-keyed, lined up. */
const ghostIdeas = (
	proposals: {
		text: string
		kind: 'idea' | 'question'
		connectTo?: string
		connectLabel?: string
	}[]
) =>
	proposals.map((proposal, index) => ({
		id: `idea-${index}`,
		text: proposal.text,
		kind: proposal.kind,
		x: index * 10,
		y: 0,
		...(proposal.connectTo
			? {
					connectTo: proposal.connectTo,
					...(proposal.connectLabel ? { connectLabel: proposal.connectLabel } : {}),
				}
			: {}),
	}))

/** A board reading that contradicts anything asked of it: every idea the episode named has gone. */
const emptyBoard: EpisodeValidity = {
	centers: {},
	influence: {},
	gravity: {},
	relationEnds: [],
	radius: {},
}

/**
 * A board reading that bears out `meaningful()` and the `c → d` rise beside it.
 *
 * Both pairs are still sitting at the influence the episode said they had risen to, and the
 * notes are all still there — which is what a remark about them being drawn together needs in
 * order to still be true.
 */
const intactBoard: EpisodeValidity = {
	centers: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 }, d: { x: 0, y: 0 } },
	influence: { [pairKey('a', 'b')]: 0.58, [pairKey('c', 'd')]: 0.7 },
	gravity: {},
	relationEnds: [],
	radius: {},
}

/** Let all pending microtasks (awaited promises) settle. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	observationEnabled.set(true)
	voiceEnabled.set(true)
	companionStage.set('idle')
	companionTranscript.set([])
	companionUtterance.set(null)
	companionPacing.set({ idleMs: EPISODE_IDLE_MS, dropped: 0 })
	companionFocus.set([])
	companionQueue.set([])
	groupingSuggestion.set(null)
	ideaSuggestions.set([])
	relationSuggestions.set([])
	boardUnderstanding.set(null)
})

describe('createCompanion', () => {
	it('consults the observer for a meaningful episode and speaks the comment', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()

		expect(calls).toHaveLength(0)
		expect(companionStage.get()).toBe('idle')
	})

	it('queues a second episode rather than calling the first one off', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		stream.emit([influence('c', 'd', 0.1, 0.7)])
		timer.flush()

		// Both are asked at once. The companion used to abort the first here, on the grounds
		// that the canvas had moved on — which meant a burst of gestures produced one remark,
		// about the last of them, and nothing about the rest.
		expect(calls).toHaveLength(2)
		expect(calls[0].signal?.aborted).toBe(false)
		expect(calls[1].signal?.aborted).toBe(false)
		expect(companionQueue.get().map((thought) => thought.state)).toEqual(['thinking', 'thinking'])
	})

	it('passes recent comments to the observer so it can avoid repeating itself', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice } = fakeVoice()
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
	// A queue is not a race. The second answer arriving first is the ordinary case — the
	// requests are concurrent and the model is not — and the whole promise of speaking in
	// gesture order rests on it waiting anyway.
	it('speaks a burst in the order the gestures happened, not the order the answers arrive', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

		stream.emit([meaningful()])
		timer.flush()
		stream.emit([influence('c', 'd', 0.1, 0.7)])
		timer.flush()

		calls[1].resolve({ speak: true, comment: 'about the second gesture' })
		await tick()

		// Ready, and still waiting: the gesture before it has not been answered yet.
		expect(spoken).toEqual([])
		expect(companionQueue.get().map((thought) => thought.state)).toEqual(['thinking', 'ready'])

		calls[0].resolve({ speak: true, comment: 'about the first gesture' })
		await tick()

		expect(spoken).toEqual(['about the first gesture', 'about the second gesture'])
		expect(companionTranscript.get().map((entry) => entry.comment)).toEqual([
			'about the first gesture',
			'about the second gesture',
		])
		expect(companionQueue.get()).toEqual([])
	})

	it('gives up on a head that is still thinking long after the ones behind it are ready', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const clock = controllableClock()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			schedule: timer.schedule,
			now: clock.now,
		})

		stream.emit([meaningful()])
		timer.flush()
		stream.emit([influence('c', 'd', 0.1, 0.7)])
		timer.flush()

		// The observer's own ceiling is twenty seconds, which is the right patience for a lone
		// request and far too much for one holding up a remark that is ready now.
		clock.advance(HEAD_OF_LINE_MS + 1)
		calls[1].resolve({ speak: true, comment: 'the one that was ready' })
		await tick()

		expect(spoken).toEqual(['the one that was ready'])
		expect(calls[0].signal?.aborted).toBe(true)
		expect(companionPacing.get().dropped).toBe(1)
	})

	it('discards the answer to a thought that has been dismissed', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		const companion = createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			schedule: timer.schedule,
		})

		stream.emit([meaningful()])
		timer.flush()
		companion.cancelThought(companionQueue.get()[0].id)

		// The real observer may well have sent the request already and answer anyway.
		calls[0].resolve({ speak: true, comment: 'nobody asked for this any more' })
		await tick()

		expect(spoken).toEqual([])
		expect(companionTranscript.get()).toEqual([])
		// The user's own decision, so it says nothing about how long the pause should be.
		expect(companionPacing.get().dropped).toBe(0)
	})

	it('keeps quiet when observation is switched off while it is thinking', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls } = fakeObserver()
		const { voice, spoken } = fakeVoice()
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
		createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
			minDwellMs: 0,
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
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			schedule: timer.schedule,
			historySize: 2,
		})

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
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			schedule: timer.schedule,
			board: () => board,
		})

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
			minDwellMs: 0,
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
				minDwellMs: 0,
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
				minDwellMs: 0,
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
			groupingSuggestion.set({ members: ['a', 'b'], targets: [], rationale: 'x' })
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
				minDwellMs: 0,
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

			companion.requestGrouping('by theme')

			expect(suggester.calls).toHaveLength(1)
			expect(suggester.calls[0].request.trigger).toBe('demand')
			expect(suggester.calls[0].request.intent).toBe('by theme')

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
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				suggest: suggester.client,
				planGrouping: linePlan,
			})

			companion.requestGrouping('by theme')
			suggester.calls[0].resolve({ members: [], rationale: '' })
			await tick()

			expect(groupingSuggestion.get()).toBeNull()
			expect(spoken).toEqual([])
			expect(companionStage.get()).toBe('idle')
		})

		it("comments on the board's new state when a grouping is accepted, and swallows its own move", async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			const reflecter = fakeReflecter()
			let applied = 0
			const companion = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				reflect: reflecter.client,
				applyGrouping: (plan) => {
					applied = plan.targets.length
					return applied
				},
			})

			groupingSuggestion.set({
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

			// It reads the new board and comments on the change, rather than a canned line.
			expect(reflecter.calls).toHaveLength(1)
			expect(reflecter.calls[0].request.recentChange).toContain('These three belong together.')
			reflecter.calls[0].resolve({ comment: 'The board now leans toward revenue.', ideas: [] })
			await tick()
			expect(spoken).toEqual(['The board now leans toward revenue.'])

			// The repositioning finalizes as an episode moments later; it must be swallowed so the
			// comment above is the only remark about it.
			stream.emit([meaningful()])
			timer.flush()
			expect(calls).toHaveLength(0)
		})
	})

	describe('board reflection', () => {
		it('speaks the reading and ghosts the proposed ideas on demand', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			const reflecter = fakeReflecter()
			const companion = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				reflect: reflecter.client,
				planIdeas: ghostIdeas,
				createAgentNotes: () => [],
			})

			companion.requestReflection('synthesizer')
			expect(reflecter.calls).toHaveLength(1)

			reflecter.calls[0].resolve({
				comment: 'This board is really about activation.',
				ideas: [{ text: 'time to first value', kind: 'idea' }],
			})
			await tick()

			expect(spoken).toEqual(['This board is really about activation.'])
			expect(ideaSuggestions.get().map((g) => g.text)).toEqual(['time to first value'])
		})

		it('speaks a reading that proposes nothing without ghosting anything', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			const reflecter = fakeReflecter()
			const companion = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				reflect: reflecter.client,
				planIdeas: ghostIdeas,
				createAgentNotes: () => [],
			})

			companion.requestReflection('synthesizer')
			reflecter.calls[0].resolve({ comment: 'Coming along nicely.', ideas: [] })
			await tick()

			expect(spoken).toEqual(['Coming along nicely.'])
			expect(ideaSuggestions.get()).toEqual([])
		})

		it('does not consult the observer while idea ghosts are pending', () => {
			ideaSuggestions.set([{ id: 'idea-0', text: 'x', kind: 'idea', x: 0, y: 0 }])
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()

			expect(calls).toHaveLength(0)
		})

		it('commits chosen ideas as agent notes and swallows its own edit', async () => {
			const created: { text: string }[] = []
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			const reflecter = fakeReflecter()
			const companion = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				reflect: reflecter.client,
				planIdeas: ghostIdeas,
				createAgentNotes: (notes) => {
					created.push(...notes)
					return notes.map((_, index) => `new-${index}`)
				},
			})

			companion.requestReflection('synthesizer')
			reflecter.calls[0].resolve({
				comment: '',
				ideas: [
					{ text: 'A', kind: 'idea' },
					{ text: 'B', kind: 'question' },
				],
			})
			await tick()
			expect(ideaSuggestions.get().map((g) => g.text)).toEqual(['A', 'B'])

			companion.commitIdeas(['idea-0', 'idea-1'])

			expect(created.map((c) => c.text)).toEqual(['A', 'B'])
			expect(ideaSuggestions.get()).toEqual([])

			// It comments on the board's new state after adding, rather than staying silent.
			expect(reflecter.calls).toHaveLength(2)
			expect(reflecter.calls[1].request.recentChange).toContain('added 2')

			// The notes it just added finalize as an episode; it must not narrate its own work
			// a second time.
			stream.emit([meaningful()])
			timer.flush()
			expect(calls).toHaveLength(0)
		})

		it('ghosts proposed arrows between existing notes and commits chosen ones', async () => {
			const drawn: { from: string; to: string; label?: string }[] = []
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice } = fakeVoice()
			const reflecter = fakeReflecter()
			const companion = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				reflect: reflecter.client,
				planIdeas: ghostIdeas,
				createAgentNotes: () => [],
				createAgentRelations: (relations) => {
					drawn.push(...relations)
					return relations.length
				},
			})

			companion.requestReflection('synthesizer')
			reflecter.calls[0].resolve({
				comment: '',
				ideas: [],
				focus: [],
				relations: [
					{ from: 'a', to: 'b', label: 'leads to' },
					{ from: 'a', to: 'c', label: 'feeds' },
				],
			})
			await tick()
			expect(relationSuggestions.get().map((r) => [r.from, r.to])).toEqual([
				['a', 'b'],
				['a', 'c'],
			])

			companion.commitRelations(['rel-0'])
			expect(drawn).toEqual([{ from: 'a', to: 'b', label: 'leads to' }])
			expect(relationSuggestions.get().map((r) => r.id)).toEqual(['rel-1'])
		})

		it('draws the arrow a new idea asked for when the idea is committed', async () => {
			const drawn: { from: string; to: string; label?: string }[] = []
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice } = fakeVoice()
			const reflecter = fakeReflecter()
			const companion = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				board: () => scatteredBoard,
				reflect: reflecter.client,
				planIdeas: ghostIdeas,
				createAgentNotes: (notes) => notes.map((_, index) => `new-${index}`),
				createAgentRelations: (relations) => {
					drawn.push(...relations)
					return relations.length
				},
			})

			companion.requestReflection('synthesizer')
			reflecter.calls[0].resolve({
				comment: '',
				focus: [],
				relations: [],
				ideas: [{ text: 'metric', kind: 'idea', connectTo: 'a', connectLabel: 'measures' }],
			})
			await tick()
			expect(ideaSuggestions.get()[0].connectTo).toBe('a')

			companion.commitIdeas(['idea-0'])
			expect(drawn).toEqual([{ from: 'new-0', to: 'a', label: 'measures' }])
		})
	})

	describe('saying it and showing it together', () => {
		it('keeps thinking up through synthesis, then hands over to the voice', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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

		it('highlights the notes a remark is about while it speaks, then clears them', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'Those two are converging.' })
			await tick()

			// Nothing lit until the voice actually starts.
			expect(companionFocus.get()).toEqual([])
			plays[0].start()
			// The remark is about the pair the episode touched.
			expect([...companionFocus.get()].sort()).toEqual(['a', 'b'])

			plays[0].progress(1)
			expect(companionFocus.get()).toEqual([])
		})

		it('follows playback, and lets go of the utterance when the clip ends', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

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

		it('lets a remark finish before the next one is even synthesised', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const voiceFake = fakeVoice({ manual: true })
			createCompanion({
				minDwellMs: 0,
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

			// A second gesture, answered while the first is still being spoken. The companion
			// used to stop the clip here, because the newer thought had taken the voice; with a
			// queue there is nothing to stop, because nothing else has asked for it.
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			timer.flush()
			calls[1].resolve({ speak: true, comment: 'The second remark.' })
			await tick()

			expect(voiceFake.stopped).toBe(0)
			expect(voiceFake.spoken).toEqual(['The first remark.'])
			expect(companionUtterance.get()?.comment).toBe('The first remark.')

			voiceFake.plays[0].finish()
			await tick()

			expect(voiceFake.spoken).toEqual(['The first remark.', 'The second remark.'])
		})

		it('ignores progress from a clip the remark after it has replaced', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, plays } = fakeVoice({ manual: true })
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'The first remark.' })
			await tick()
			plays[0].start()

			stream.emit([influence('c', 'd', 0.1, 0.7)])
			timer.flush()
			calls[1].resolve({ speak: true, comment: 'The second remark.' })
			await tick()

			plays[0].finish()
			await tick()
			plays[1].start()

			expect(companionUtterance.get()?.comment).toBe('The second remark.')

			// A released element can still deliver a frame or two. They must not put the
			// finished sentence back on screen over the one now being spoken.
			plays[0].progress(0.9)

			expect(companionUtterance.get()?.comment).toBe('The second remark.')
		})
	})

	/**
	 * The queue is what the companion does instead of forgetting, and these are its edges: what
	 * it keeps, what it lets go of at the door, and what any of that teaches the pause.
	 *
	 * The old answer to a user who came back mid-thought was to kill the thought. It is now to
	 * keep it and ask, at the last moment silence is still free, whether it is worth saying.
	 */
	describe('the queue', () => {
		it('keeps a thought when the user comes back, instead of throwing it away', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			// One event, no flush: the user is back and the next gesture is still being buffered.
			// This used to abort the request outright.
			stream.emit([influence('c', 'd', 0.1, 0.7)])

			expect(calls[0].signal?.aborted).toBe(false)
			expect(companionQueue.get()).toHaveLength(1)
			expect(companionStage.get()).toBe('observing')
		})

		it('still speaks an answer the user came back before hearing', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			stream.emit([influence('c', 'd', 0.1, 0.7)])

			calls[0].resolve({ speak: true, comment: 'Those two are converging.' })
			await tick()

			expect(spoken).toEqual(['Those two are converging.'])
			expect(companionPacing.get().dropped).toBe(0)
		})

		it('leaves a remark it has already begun speaking alone', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const voiceFake = fakeVoice({ manual: true })
			createCompanion({
				minDwellMs: 0,
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

		it('drops a remark the board no longer bears out, without saying or recording it', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				// Every idea the episode named has gone from the board.
				verify: () => emptyBoard,
			})

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'About two notes that no longer exist.' })
			await tick()

			expect(spoken).toEqual([])
			// Recorded at the door rather than when the model answered, so a dropped remark
			// never reaches the transcript — where the bar would show it and the next prompt
			// would be told the companion had said it.
			expect(companionTranscript.get()).toEqual([])
			expect(companionPacing.get().dropped).toBe(1)
			expect(companionQueue.get()).toEqual([])
		})

		it('drops a remark that has waited too long to be worth hearing', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				now: clock.now,
			})

			stream.emit([meaningful()])
			timer.flush()
			// Nothing about the episode has been contradicted; it is simply half a minute late,
			// which is the rule the validity check cannot express because nothing records what
			// the remark actually claimed.
			clock.advance(MAX_REMARK_AGE_MS + 1)
			calls[0].resolve({ speak: true, comment: 'True, and far too late.' })
			await tick()

			expect(spoken).toEqual([])
			expect(companionPacing.get().dropped).toBe(1)
		})

		it('carries a gesture the queue had no room for into the next thought', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			// Fill it. None of these answer, so every slot stays taken.
			for (let i = 0; i < QUEUE_LIMIT; i += 1) {
				stream.emit([influence(`s${i}`, `t${i}`, 0.04, 0.58)])
				timer.flush()
			}
			expect(calls).toHaveLength(QUEUE_LIMIT)

			// One gesture too many. The cap sits above the model call, not above the chip, so
			// this costs nothing — and it is not lost either.
			stream.emit([influence('a', 'b', 0.04, 0.58)])
			timer.flush()
			expect(calls).toHaveLength(QUEUE_LIMIT)

			// A slot frees, and the overflow rides into the next thought rather than waiting
			// for a gesture that may never come.
			calls[0].resolve({ speak: false, comment: null })

			return tick().then(() => {
				expect(calls).toHaveLength(QUEUE_LIMIT + 1)
				expect(calls[QUEUE_LIMIT].request.episode.pairs).toEqual([
					{
						source: 'a',
						target: 'b',
						before: { influence: 0.04 },
						after: { influence: 0.58 },
						transitions: ['influence_changed'],
					},
				])
			})
		})

		it('keeps an open arc whole when the episode it merges into reads as trivial', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			for (let i = 0; i < QUEUE_LIMIT; i += 1) {
				stream.emit([influence(`s${i}`, `t${i}`, 0.04, 0.58)])
				timer.flush()
			}

			// Overflow opens an arc: this one had nowhere to go.
			stream.emit([influence('a', 'b', 0.04, 0.58)])
			timer.flush()

			// The user comes back and undoes most of it, taking a node with them. Merged with
			// the carried arc this nets out to almost nothing, so the local gate drops it — but
			// dropping the *episode* must not drop the arc, or the move rides along in nothing
			// and the eventual remark describes a canvas that never existed.
			stream.emit([influence('a', 'b', 0.58, 0.06), moved('z')])
			timer.flush()
			expect(calls).toHaveLength(QUEUE_LIMIT)

			calls[0].resolve({ speak: false, comment: null })
			await tick()
			stream.emit([influence('a', 'b', 0.06, 0.7)])
			timer.flush()

			expect(calls).toHaveLength(QUEUE_LIMIT + 1)
			expect(calls[QUEUE_LIMIT].request.episode.structural).toEqual([moved('z')])
			expect(calls[QUEUE_LIMIT].request.episode.pairs[0].before).toEqual({ influence: 0.04 })
		})

		it('tells the observer what it is already about to say, so it does not say it twice', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice({ manual: true })
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			timer.flush()

			// Answered but not yet spoken, so the transcript — which is written at the door —
			// knows nothing about it. Without the queue in `recentComments`, two concurrent
			// requests would be handed identical history and could easily agree.
			calls[1].resolve({ speak: true, comment: 'a remark waiting its turn' })
			await tick()

			stream.emit([influence('e', 'f', 0.1, 0.7)])
			timer.flush()

			expect(calls[2].request.recentComments).toEqual(['a remark waiting its turn'])
		})

		it('lets the words land one at a time when there is no voice to pace them', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const dwell = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			voiceEnabled.set(false)
			createCompanion({
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				delay: dwell.schedule,
			})

			stream.emit([meaningful()])
			timer.flush()
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'first' })
			calls[1].resolve({ speak: true, comment: 'second' })
			await tick()

			// With voice off, speaking costs nothing and returns at once. Without a floor the
			// queue would empty inside a tick — two remarks in one frame, and slots freeing so
			// fast that nothing throttles the observe rate behind them.
			expect(companionTranscript.get().map((entry) => entry.comment)).toEqual(['first'])
			expect(dwell.lastMs).toBe(MIN_DWELL_MS)

			dwell.flush()
			await tick()

			expect(companionTranscript.get().map((entry) => entry.comment)).toEqual(['first', 'second'])
		})

		it('collects a remark left waiting behind a ghost nobody decided', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const wake = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				delay: wake.schedule,
				now: clock.now,
			})

			stream.emit([meaningful()])
			timer.flush()
			calls[0].resolve({ speak: true, comment: 'A remark with a ghost in front of it.' })
			// A proposal lands before it can be spoken. Never talking over a pending ghost is an
			// invariant older than the queue, so it waits — but nothing is coming to wake it, and
			// the age cap that is supposed to collect it is only read inside the pump.
			groupingSuggestion.set({ members: ['a', 'b'], targets: [], rationale: 'grouped' })
			await tick()

			expect(spoken).toEqual([])
			expect(wake.lastMs).toBe(MAX_REMARK_AGE_MS)

			clock.advance(MAX_REMARK_AGE_MS + 1)
			wake.flush()
			await tick()

			expect(spoken).toEqual([])
			expect(companionTranscript.get()).toEqual([])
			expect(companionQueue.get()).toEqual([])
			expect(companionPacing.get().dropped).toBe(1)
		})

		it('speaks what was waiting once the ghost is decided', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice, spoken } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			stream.emit([meaningful()])
			timer.flush()
			groupingSuggestion.set({ members: ['a', 'b'], targets: [], rationale: 'grouped' })
			calls[0].resolve({ speak: true, comment: 'A remark with a ghost in front of it.' })
			await tick()
			expect(spoken).toEqual([])

			// Dismissed from the controls, which only clear the atom — the companion watches for
			// that rather than being told, since four different places can clear a ghost.
			groupingSuggestion.set(null)
			await tick()

			expect(spoken).toEqual(['A remark with a ghost in front of it.'])
		})

		it('forgets the whole queue on teardown', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			const { dispose } = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
			})

			stream.emit([meaningful()])
			timer.flush()
			expect(companionQueue.get()).toHaveLength(1)

			dispose()

			expect(companionQueue.get()).toEqual([])
			expect(calls[0].signal?.aborted).toBe(true)
			expect(companionStage.get()).toBe('idle')
		})
	})

	/**
	 * The pause before a thought starts is a guess about one user's rhythm, and the ~4.7s of
	 * model call and synthesis behind it is time the canvas can change out from under the
	 * answer. Nothing is killed any more, so the guess learns from a narrower signal: a remark
	 * the board turned out not to bear out, told by a user who came *straight* back after the
	 * pause fired. Either half alone means something else — a prompt return whose remark still
	 * held says the pause was fine, and a remark stale a minute later says the board moved on.
	 */
	describe('pacing itself against the user', () => {
		it('stretches the pause past the rhythm that fooled it, then eases back', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			let stale = true
			createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				now: clock.now,
				verify: () => (stale ? emptyBoard : intactBoard),
			})

			stream.emit([meaningful()])
			expect(timer.lastMs).toBe(EPISODE_IDLE_MS)

			// The episode closes on schedule, and the user comes back half a second later —
			// so 1.7s of quiet was not the end of anything. That only becomes evidence once
			// the remark it produced turns out to be about a board that has moved on.
			clock.advance(EPISODE_IDLE_MS)
			timer.flush()
			clock.advance(500)
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			calls[0].resolve({ speak: true, comment: 'About a canvas that has moved on.' })
			await tick()

			// Past the 1.7s that fooled it, by the margin.
			const stretched = EPISODE_IDLE_MS + 500 + IDLE_BACKOFF_MARGIN_MS
			expect(companionPacing.get()).toEqual({ idleMs: stretched, dropped: 1 })

			// The next one lands: the longer pause was long enough, so half the penalty is
			// handed back rather than the companion staying cautious for the whole session.
			stale = false
			timer.flush()
			calls[1].resolve({ speak: true, comment: 'This one lands.' })
			await tick()

			expect(companionPacing.get().idleMs).toBe(EPISODE_IDLE_MS + (stretched - EPISODE_IDLE_MS) / 2)
		})

		it('learns nothing from a thought the user was nowhere near', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				now: clock.now,
				verify: () => emptyBoard,
			})

			stream.emit([meaningful()])
			clock.advance(EPISODE_IDLE_MS)
			timer.flush()

			// The board moved on — but not because the pause was short. The user wandered back
			// a long while later, or something else took the notes away. The remark is dropped
			// and the pause is left exactly where it was.
			clock.advance(30_000)
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			calls[0].resolve({ speak: true, comment: 'About a canvas that has moved on.' })
			await tick()

			expect(companionPacing.get()).toEqual({ idleMs: EPISODE_IDLE_MS, dropped: 1 })
		})

		it('never stretches past the ceiling', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				now: clock.now,
				verify: () => emptyBoard,
			})

			// A user arranging in bursts: every episode closes, the user is straight back on it,
			// and every remark it produced lands on a board that has moved on.
			for (let i = 0; i < 12; i += 1) {
				stream.emit([influence('a', 'b', 0.04 + i / 100, 0.58 + i / 100)])
				clock.advance(timer.lastMs)
				timer.flush()
				clock.advance(300)
				stream.emit([influence('a', 'b', 0.5, 0.9)])
				calls[i].resolve({ speak: true, comment: `remark ${i}` })
				await tick()
			}

			expect(companionPacing.get().idleMs).toBe(IDLE_BACKOFF_CAP_MS)
			expect(timer.lastMs).toBe(IDLE_BACKOFF_CAP_MS)
		})

		it('does not penalise a pause no thought was waiting on', () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const { observer } = fakeObserver()
			const { voice } = fakeVoice()
			createCompanion({ minDwellMs: 0, stream, observer, voice, schedule: timer.schedule })

			// The local gate dropped this one, so nothing was in flight and the pause was
			// never shown to be too short.
			stream.emit([trivial()])
			timer.flush()
			stream.emit([trivial()])

			expect(companionPacing.get()).toEqual({ idleMs: EPISODE_IDLE_MS, dropped: 0 })
		})

		it('resets the pacing readout on teardown', async () => {
			const stream = createEventStream()
			const timer = controllableSchedule()
			const clock = controllableClock()
			const { observer, calls } = fakeObserver()
			const { voice } = fakeVoice()
			const { dispose } = createCompanion({
				minDwellMs: 0,
				stream,
				observer,
				voice,
				schedule: timer.schedule,
				now: clock.now,
				verify: () => emptyBoard,
			})

			stream.emit([meaningful()])
			clock.advance(EPISODE_IDLE_MS)
			timer.flush()
			clock.advance(500)
			stream.emit([influence('c', 'd', 0.1, 0.7)])
			calls[0].resolve({ speak: true, comment: 'About a canvas that has moved on.' })
			await tick()
			expect(companionPacing.get().dropped).toBe(1)

			// A StrictMode remount must not inherit the last mount's rhythm.
			dispose()

			expect(companionPacing.get()).toEqual({ idleMs: EPISODE_IDLE_MS, dropped: 0 })
		})
	})
})

describe('the standing understanding', () => {
	it('derives once the board drifts past the threshold', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer } = fakeObserver()
		const { voice } = fakeVoice()
		const { client: digest, calls } = fakeDigester()
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			digest,
			board: () => scatteredBoard,
			schedule: timer.schedule,
		})

		// Two new notes is drift 6 — exactly the threshold.
		stream.emit([
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'node_created', nodeId: 'b' },
		])
		timer.flush()

		expect(calls).toHaveLength(1)
	})

	it('does not derive for dragging, however much of it', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer } = fakeObserver()
		const { voice } = fakeVoice()
		const { client: digest, calls } = fakeDigester()
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			digest,
			board: () => scatteredBoard,
			schedule: timer.schedule,
		})

		for (let i = 0; i < 50; i++) {
			stream.emit([
				{ type: 'node_moved', nodeId: 'a', previous: { x: 0, y: 0 }, current: { x: i, y: i } },
			])
		}
		timer.flush()

		expect(calls).toHaveLength(0)
	})

	it('never puts a derivation in the thought queue', () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer } = fakeObserver()
		const { voice } = fakeVoice()
		const { client: digest } = fakeDigester()
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			digest,
			board: () => scatteredBoard,
			schedule: timer.schedule,
		})

		stream.emit([
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'node_created', nodeId: 'b' },
		])
		timer.flush()

		// A digest speaks to nobody, so it must never take a speaking slot.
		expect(companionQueue.get().some((thought) => thought.gesture.includes('digest'))).toBe(false)
	})

	it('keeps the previous understanding when a later derivation fails', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer } = fakeObserver()
		const { voice } = fakeVoice()
		const { client: digest, calls } = fakeDigester()
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			digest,
			board: () => scatteredBoard,
			schedule: timer.schedule,
		})

		stream.emit([
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'node_created', nodeId: 'b' },
		])
		timer.flush()
		calls[0].resolve({ ...EMPTY_UNDERSTANDING, reading: 'A board about why deals stall.' })
		await tick()

		stream.emit([
			{ type: 'node_created', nodeId: 'c' },
			{ type: 'node_created', nodeId: 'd' },
		])
		timer.flush()
		calls[1].reject(new Error('502'))
		await tick()

		expect(boardUnderstanding.get()?.reading).toBe('A board about why deals stall.')
	})

	it('ships the understanding and its staleness to the observer', async () => {
		const stream = createEventStream()
		const timer = controllableSchedule()
		const { observer, calls: observed } = fakeObserver()
		const { voice } = fakeVoice()
		const { client: digest, calls } = fakeDigester()
		createCompanion({
			minDwellMs: 0,
			stream,
			observer,
			voice,
			digest,
			board: () => scatteredBoard,
			schedule: timer.schedule,
		})

		stream.emit([
			{ type: 'node_created', nodeId: 'a' },
			{ type: 'node_created', nodeId: 'b' },
		])
		timer.flush()
		calls[0].resolve({ ...EMPTY_UNDERSTANDING, reading: 'A board about why deals stall.' })
		await tick()

		stream.emit([{ type: 'node_created', nodeId: 'c' }])
		timer.flush()

		const request = observed.at(-1)!.request
		expect(request.understanding?.reading).toBe('A board about why deals stall.')
		expect(request.driftSince).toBeGreaterThan(0)
	})
})
