// @vitest-environment jsdom
/**
 * The voice client's terminal callback.
 *
 * `speak()` resolves when playback *starts*, which is the right seam for the text/voice
 * handover but says nothing about when the clip is over. A caller that speaks remarks in
 * turn needs the other edge, and it needs it to be total: a promise that can fail to settle
 * is a queue that can fail to drain. So the contract these tests pin is not "usually fires"
 * but **fires exactly once, however the clip ends** — including the endings that produce no
 * DOM event at all.
 *
 * `stop()` is the one that used to be silent. It ends a clip with `audio.pause()`, which
 * fires neither `ended` nor `error`, and it drops the element the progress sampler was
 * watching — so before `onEnd` there was no way to learn that a stopped clip had stopped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpVoiceClient } from '@/companion/voiceClient'

/**
 * A stand-in for the audio element, because jsdom's does not play.
 *
 * `play()` is a no-op promise rather than jsdom's "not implemented" throw, and `ended` /
 * `error` are fired by hand — the point of these tests is which endings reach the caller,
 * so the endings have to be under the test's control.
 */
class FakeAudio {
	static last: FakeAudio | null = null

	src: string
	paused = false
	currentTime = 0
	duration = 10
	playRejection: Error | null = null
	private listeners = new Map<string, (() => void)[]>()

	constructor(src: string) {
		this.src = src
		FakeAudio.last = this
	}

	addEventListener(type: string, listener: () => void) {
		const existing = this.listeners.get(type) ?? []
		this.listeners.set(type, [...existing, listener])
	}

	emit(type: string) {
		for (const listener of this.listeners.get(type) ?? []) listener()
	}

	pause() {
		this.paused = true
	}

	play() {
		return this.playRejection ? Promise.reject(this.playRejection) : Promise.resolve()
	}
}

/** Only the three members the client reads. jsdom's `Blob` will not travel through a real `Response`. */
const audioResponse = () => ({ ok: true, status: 200, blob: async () => ({}) })

let revoked: string[]

beforeEach(() => {
	revoked = []
	FakeAudio.last = null
	vi.stubGlobal('Audio', FakeAudio)
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => audioResponse())
	)
	vi.stubGlobal('requestAnimationFrame', () => 1)
	vi.stubGlobal('cancelAnimationFrame', () => {})
	URL.createObjectURL = () => 'blob:fake'
	URL.revokeObjectURL = (url: string) => void revoked.push(url)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('createHttpVoiceClient — onEnd', () => {
	it('reports the end when the clip plays out', async () => {
		const voice = createHttpVoiceClient()
		const onEnd = vi.fn()

		await voice.speak('a remark', { onEnd })
		expect(onEnd).not.toHaveBeenCalled()

		FakeAudio.last!.emit('ended')

		expect(onEnd).toHaveBeenCalledTimes(1)
	})

	it('reports the end when the clip is stopped mid-sentence', async () => {
		// The deadlock this callback exists for: `pause()` fires no DOM event, so without
		// `onEnd` a caller waiting on the clip would wait forever.
		const voice = createHttpVoiceClient()
		const onEnd = vi.fn()

		await voice.speak('a remark', { onEnd })
		voice.stop()

		expect(onEnd).toHaveBeenCalledTimes(1)
		expect(FakeAudio.last!.paused).toBe(true)
	})

	it('reports the end when the element errors', async () => {
		const voice = createHttpVoiceClient()
		const onEnd = vi.fn()

		await voice.speak('a remark', { onEnd })
		FakeAudio.last!.emit('error')

		expect(onEnd).toHaveBeenCalledTimes(1)
	})

	it('reports the end when playback is refused', async () => {
		// Autoplay blocked: `play()` rejects and fires neither `ended` nor `error`.
		const voice = createHttpVoiceClient()
		const onEnd = vi.fn()

		const blocked = new FakeAudio('')
		vi.stubGlobal('Audio', function () {
			blocked.playRejection = new Error('NotAllowedError')
			FakeAudio.last = blocked
			return blocked
		})

		await expect(voice.speak('a remark', { onEnd })).rejects.toThrow()

		expect(onEnd).toHaveBeenCalledTimes(1)
	})

	it('reports the end when a newer clip replaces this one', async () => {
		const voice = createHttpVoiceClient()
		const first = vi.fn()
		const second = vi.fn()

		await voice.speak('first', { onEnd: first })
		await voice.speak('second', { onEnd: second })

		expect(first).toHaveBeenCalledTimes(1)
		expect(second).not.toHaveBeenCalled()
	})

	it('reports the end when the request is called off before any sound', async () => {
		// Aborted after the bytes arrived but before an element exists: `speak` resolves
		// normally and no element is ever created, so this path has to report the end itself.
		const voice = createHttpVoiceClient()
		const onEnd = vi.fn()
		const controller = new AbortController()
		vi.stubGlobal('fetch', async () => {
			controller.abort()
			return audioResponse()
		})

		await voice.speak('a remark', { onEnd, signal: controller.signal })

		expect(onEnd).toHaveBeenCalledTimes(1)
	})

	it('reports the end exactly once when it is reached twice', async () => {
		const voice = createHttpVoiceClient()
		const onEnd = vi.fn()

		await voice.speak('a remark', { onEnd })
		FakeAudio.last!.emit('ended')
		voice.stop()

		expect(onEnd).toHaveBeenCalledTimes(1)
	})
})

describe('createHttpVoiceClient — the request', () => {
	it('gives up on a synthesis that never answers', async () => {
		const voice = createHttpVoiceClient()
		const seen: (AbortSignal | undefined)[] = []
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			seen.push(init.signal ?? undefined)
			return audioResponse()
		})

		await voice.speak('a remark')

		// A hung /api/speak must not pin a caller waiting on this clip forever, so the
		// request carries a deadline of its own — the same guard the observer has.
		expect(seen[0]).toBeDefined()
	})
})
