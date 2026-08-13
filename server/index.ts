/**
 * The one server the demo needs.
 *
 * The repo was backend-free by design; this is its first server, and it exists only
 * because the AI companion must keep two API keys off the browser. It does two things:
 * proxy `/api/observe` and `/api/speak` to the models (keys read from the environment),
 * and, in production, serve the built client from `dist/`. In development the client is
 * served by Vite, which proxies `/api` here — so this process only handles the two routes.
 *
 * `.env` is loaded before anything that reads it. Both handlers read their config inside
 * the call for the same reason: ESM evaluates imported modules before this file's body.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Load .env if present; in a real deployment the vars come from the environment instead.
try {
	process.loadEnvFile()
} catch {
	// No .env file — rely on real environment variables.
}

const { observe } = await import('./observe.ts')
const { synthesize } = await import('./speak.ts')

const app = new Hono()

/**
 * A cap on both routes.
 *
 * Each request costs real money at a paid API, and the episode is caller-supplied, so an
 * unbounded body is an unbounded bill. Generous enough for the largest real episode.
 */
const limit = bodyLimit({ maxSize: 256 * 1024 })

app.post('/api/observe', limit, async (c) => {
	try {
		const payload = await c.req.json()
		return c.json(await observe(payload))
	} catch (error) {
		console.error('[observe] failed:', error)
		// Fail safe: a broken observation is silence, never a thrown error at the user.
		// Inside the try alongside the parse, so a malformed body degrades the same way.
		return c.json({ speak: false, comment: '' })
	}
})

app.post('/api/speak', limit, async (c) => {
	try {
		const { text } = (await c.req.json()) as { text?: string }
		if (typeof text !== 'string' || text.trim() === '') return c.body(null, 400)
		const audio = await synthesize(text)
		return new Response(new Uint8Array(audio), { headers: { 'content-type': 'audio/mpeg' } })
	} catch (error) {
		console.error('[speak] failed:', error)
		return c.body(null, 502)
	}
})

// Production: serve the built client. Resolved from this file rather than the working
// directory, so `npm start` works from anywhere; skipped entirely when there is no build,
// which is the normal case in development (Vite serves the client and proxies /api here).
const distPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(distPath)) {
	const root = relative(process.cwd(), distPath) || '.'
	app.use('/*', serveStatic({ root }))
}

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`AI companion server listening on http://localhost:${port}`)
