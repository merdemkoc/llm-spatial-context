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
	test: {
		// The adapter and domain layers are free of tldraw runtime imports, so
		// the round-trip tests need no DOM.
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
