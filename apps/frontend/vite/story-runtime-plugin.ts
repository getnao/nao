import { join, resolve } from 'node:path';

import { build } from 'vite';

import { STORY_RUNTIME_MODULES, STORY_RUNTIME_PATH, STORY_STANDALONE_RUNTIME_FILE } from '../../shared/src/story-app';
import type { InlineConfig, Plugin, ResolvedConfig, Rollup } from 'vite';

const ENTRY_DIR = 'src/story-runtime';
const RUNTIME_DIR = STORY_RUNTIME_PATH.slice(1);
const ENTRY_NAMES = [...new Set(Object.values(STORY_RUNTIME_MODULES))];
const STANDALONE_ENTRY = 'standalone.ts';
const STANDALONE_URL = `${STORY_RUNTIME_PATH}/${STORY_STANDALONE_RUNTIME_FILE}`;

/**
 * Runtime sources (and the shared modules they import) run inside the story frame, which has no fast-refresh preamble:
 * keep them out of `@vitejs/plugin-react`.
 */
export const STORY_RUNTIME_SOURCES = /\/(frontend\/src\/story-runtime|shared\/src)\//;

export function storyRuntime(): Plugin {
	let config: ResolvedConfig;
	let standaloneSource: Promise<string> | null = null;

	return {
		name: 'nao:story-runtime',
		config() {
			return { server: { cors: { preflightContinue: true } } };
		},
		configResolved(resolved) {
			config = resolved;
		},
		configureServer(server) {
			server.watcher.on('change', (file) => {
				if (STORY_RUNTIME_SOURCES.test(file)) {
					standaloneSource = null;
				}
			});
			server.middlewares.use(async (request, response, next) => {
				if (request.url !== STANDALONE_URL) {
					next();
					return;
				}
				try {
					standaloneSource ??= buildStandaloneSource(config.root);
					response.setHeader('Content-Type', 'text/javascript');
					response.end(await standaloneSource);
				} catch (error) {
					standaloneSource = null;
					next(error);
				}
			});
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
			await build(standaloneBuildConfig(config.root, join(config.build.outDir, RUNTIME_DIR), true));
			config.logger.info(
				`built ${RUNTIME_DIR}/ (${ENTRY_NAMES.length} modules + ${STORY_STANDALONE_RUNTIME_FILE})`,
			);
		},
	};
}

/** In dev the standalone runtime is built on first request and kept until a runtime source changes. */
async function buildStandaloneSource(root: string): Promise<string> {
	const output = (await build(standaloneBuildConfig(root, '', false))) as Rollup.RollupOutput[];
	const chunk = output[0].output.find((file): file is Rollup.OutputChunk => file.type === 'chunk');
	if (!chunk) {
		throw new Error('The standalone story runtime produced no output.');
	}
	return chunk.code;
}

function standaloneBuildConfig(root: string, outDir: string, write: boolean): InlineConfig {
	return {
		configFile: false,
		root,
		logLevel: 'warn',
		mode: 'production',
		define: { 'process.env.NODE_ENV': JSON.stringify('production') },
		esbuild: { jsx: 'automatic', jsxDev: false },
		build: {
			outDir,
			write,
			emptyOutDir: false,
			copyPublicDir: false,
			lib: {
				entry: resolve(root, ENTRY_DIR, STANDALONE_ENTRY),
				formats: ['iife'],
				name: 'naoStoryStandaloneRuntime',
				fileName: () => STORY_STANDALONE_RUNTIME_FILE,
			},
		},
	};
}
