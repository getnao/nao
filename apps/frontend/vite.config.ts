import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vite';

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
		viteReact(),
		svgr({
			include: '**/*.svg',
			svgrOptions: { exportType: 'default' },
		}),
		tailwindcss(),
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
		},
	},
});
