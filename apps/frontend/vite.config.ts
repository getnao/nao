import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

import { STORY_RUNTIME_SOURCES, storyRuntime } from './vite/story-runtime-plugin';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		devtools({
			enhancedLogs: {
				enabled: false,
			},
		}),
		tanstackRouter({
			target: 'react',
			autoCodeSplitting: false,
		}),
		viteReact({ exclude: [/\/node_modules\//, STORY_RUNTIME_SOURCES] }),
		svgr({
			include: '**/*.svg',
			svgrOptions: { exportType: 'default' },
		}),
		tailwindcss(),
		storyRuntime(),
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:5005',
			},
			'/mcp': {
				target: 'http://localhost:5005',
			},
			'/.well-known': {
				target: 'http://localhost:5005',
			},
			'/i/': {
				target: 'http://localhost:5005',
			},
			'/c/': {
				target: 'http://localhost:5005',
			},
			'/branding/': {
				target: 'http://localhost:5005',
			},
		},
	},
});
