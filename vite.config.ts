/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		// In development the client is served here by Vite; the AI companion's two
		// endpoints live on the standalone Node server (see `server/`), so forward
		// `/api/*` to it. Keep the port in sync with the server's PORT default.
		proxy: {
			'/api': 'http://localhost:8787',
		},
	},
	test: {
		// The adapter and domain layers are free of tldraw runtime imports, so
		// the round-trip tests need no DOM. The few suites that drive a real
		// editor or render a component opt into jsdom with a
		// `@vitest-environment jsdom` docblock.
		environment: 'node',
		include: ['src/**/*.test.{ts,tsx}'],
	},
})
