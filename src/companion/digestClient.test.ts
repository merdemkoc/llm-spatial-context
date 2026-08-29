/**
 * The client half of the digest call.
 *
 * Unlike its siblings the answer here is stored rather than spoken, so a failed or malformed
 * reply must resolve to nothing understood rather than to a partial understanding the
 * companion would then carry around as fact.
 */
import { describe, expect, it, vi } from 'vitest'
import { createHttpDigestClient, EMPTY_UNDERSTANDING } from '@/companion/digestClient'

const board = {
	nodeCount: 0,
	nodes: [],
	clusters: [],
	loners: [],
	proximities: [],
	relations: [],
	effectiveStrengths: [],
	truncated: false,
}

function respondWith(body: unknown, ok = true) {
	return vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response)
}

describe('createHttpDigestClient', () => {
	it('posts the board and returns the understanding', async () => {
		const fetchMock = respondWith({
			themes: [{ name: 'Deal friction', meaning: 'x', members: ['a', 'b'] }],
			reading: 'A board about why deals stall.',
			narrative: '',
			tensions: [],
			derivedFromNodes: ['a', 'b'],
		})
		vi.stubGlobal('fetch', fetchMock)

		const result = await createHttpDigestClient().digest({ board, recentComments: [] })

		expect(fetchMock).toHaveBeenCalledOnce()
		expect(result.reading).toBe('A board about why deals stall.')
		expect(result.themes).toHaveLength(1)
		vi.unstubAllGlobals()
	})

	it('throws on a failed request rather than inventing an understanding', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response))
		await expect(createHttpDigestClient().digest({ board, recentComments: [] })).rejects.toThrow(
			'digest failed: 502'
		)
		vi.unstubAllGlobals()
	})

	it('fills missing fields rather than returning a half-built understanding', async () => {
		vi.stubGlobal('fetch', respondWith({ reading: 'Just a reading.' }))
		const result = await createHttpDigestClient().digest({ board, recentComments: [] })
		expect(result).toEqual({ ...EMPTY_UNDERSTANDING, reading: 'Just a reading.' })
		vi.unstubAllGlobals()
	})
})
