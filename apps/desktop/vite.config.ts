import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	clearScreen: false,
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ['**/src-tauri/**'],
		},
	},
	build: {
		target: 'es2022',
		outDir: 'dist',
	},
	test: {
		include: ['tests/**/*.test.{ts,tsx}'],
		environment: 'jsdom',
	},
});
