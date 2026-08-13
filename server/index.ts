/**
 * The one server the demo needs.
 *
 * The repo was backend-free by design; this is its first server, and it exists only
 * because the AI companion must keep two API keys off the browser. It does two things:
 * proxy `/api/observe` and `/api/speak` to the models (keys read from the environment),
 * and, in production, serve the built client from `dist/`. In development the client is
 * served by Vite, which proxies `/api` here — so this process only handles the two routes.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { observe } from './observe.ts'
import { synthesize } from './speak.ts'

// Load .env if present; in a real deployment the vars come from the environment instead.
try {
	process.loadEnvFile()
} catch {
	// No .env file — rely on real environment variables.
}

const app = new Hono()

app.post('/api/observe', async (c) => {
	const payload = await c.req.json()
	try {
		return c.json(await observe(payload))
	} catch (error) {
		console.error('[observe] failed:', error)
		// Fail safe: a broken observation is silence, never a thrown error at the user.
		return c.json({ speak: false, comment: '' })
	}
})

app.post('/api/speak', async (c) => {
	const { text } = (await c.req.json()) as { text?: string }
	if (!text) return c.body(null, 400)
	try {
		const audio = await synthesize(text)
		return new Response(audio, { headers: { 'content-type': 'audio/mpeg' } })
	} catch (error) {
		console.error('[speak] failed:', error)
		return c.body(null, 502)
	}
})

// Production: serve the built client. Harmless in dev (dist may not exist; Vite serves
// the client and only proxies /api here).
app.use('/*', serveStatic({ root: './dist' }))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`AI companion server listening on http://localhost:${port}`)
