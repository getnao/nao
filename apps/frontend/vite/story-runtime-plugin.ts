import { join, resolve } from 'node:path';

import { build } from 'vite';

import { STORY_RUNTIME_MODULES, STORY_RUNTIME_PATH } from '../../shared/src/story-app';
import type { Plugin, ResolvedConfig } from 'vite';

const ENTRY_DIR = 'src/story-runtime';
const RUNTIME_DIR = STORY_RUNTIME_PATH.slice(1);
const ENTRY_NAMES = [...new Set(Object.values(STORY_RUNTIME_MODULES))];

/**
 * Runtime sources (and the shared modules they import) run inside the story frame, which has no fast-refresh preamble:
 * keep them out of `@vitejs/plugin-react`.
 */
export const STORY_RUNTIME_SOURCES = /\/(frontend\/src\/story-runtime|shared\/src)\//;

export function storyRuntime(): Plugin {
	let config: ResolvedConfig;

	return {
		name: 'nao:story-runtime',
		config() {
			return { server: { cors: { preflightContinue: true } } };
		},
		configResolved(resolved) {
			config = resolved;
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (request.headers.origin === 'null') {
					response.setHeader('Access-Control-Allow-Origin', 'null');
					response.setHeader('Access-Control-Allow-Private-Network', 'true');
				}
				if (request.method === 'OPTIONS') {
					response.statusCode = 204;
					response.end();
					return;
				}
				next();
			});
		},
		async closeBundle() {
			if (config.command !== 'build') {
				return;
			}
			await build({
				configFile: false,
				root: config.root,
				logLevel: 'warn',
				build: {
					outDir: join(config.build.outDir, RUNTIME_DIR),
					emptyOutDir: true,
					copyPublicDir: false,
					modulePreload: { polyfill: false },
					rollupOptions: {
						preserveEntrySignatures: 'strict',
						input: Object.fromEntries(
							ENTRY_NAMES.map((name) => [name, resolve(config.root, ENTRY_DIR, `${name}.ts`)]),
						),
						output: {
							entryFileNames: '[name].js',
							chunkFileNames: 'chunks/[name]-[hash].js',
						},
					},
				},
			});
			config.logger.info(`built ${RUNTIME_DIR}/ (${ENTRY_NAMES.length} modules)`);
		},
	};
}
