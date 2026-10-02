import { spawn } from 'node:child_process';

import {
	MAX_STORY_BUNDLE_BYTES,
	STORY_APP_ALLOWED_IMPORTS,
	STORY_APP_ENTRY_CANDIDATES,
	STORY_APP_MANIFEST_PATH,
	STORY_DOCUMENT_SLOTS,
	type StoryApp,
} from '@nao/shared/story-app';
import { isAllowedFontStylesheet } from '@nao/shared/story-theme';

import {
	type StoryBuildDiagnostic,
	type StoryBuildRequest,
	type StoryBuildResponse,
	storyBuildWorker,
} from './story-app-build.worker';

/**
 * Bundles a custom story's source files into one browser ES module, ready to be
 * served inside the sandboxed frame with the allowed packages supplied by an
 * import map. The build runs in a child `bun` process so a runaway build can be
 * killed without touching the API process; nothing is ever installed, and
 * imports outside the allowlist fail the build.
 */

export interface StorySourceFile {
	path: string;
	content: string;
}

export type StoryBuildResult = { ok: true; app: StoryApp; entry: string } | { ok: false; errors: string[] };

const BUILD_TIMEOUT_MS = 20_000;
const STDERR_TAIL_CHARS = 600;
const REMOTE_STYLE_IMPORT = /@import\s+(?:url\(\s*)?["']?(https?:\/\/[^"')\s;]+)/gi;

export async function buildStoryApp(files: StorySourceFile[]): Promise<StoryBuildResult> {
	const sources = Object.fromEntries(files.map((file) => [file.path, file.content]));
	const entry = resolveEntry(sources);
	if (!entry.ok) {
		return entry;
	}
	const styleErrors = remoteStylesheetErrors(files);
	if (styleErrors.length > 0) {
		return { ok: false, errors: styleErrors };
	}

	const response = await runBuildWorker({
		entry: entry.path,
		files: sources,
		allowedImports: [...STORY_APP_ALLOWED_IMPORTS],
		documentSlots: STORY_DOCUMENT_SLOTS,
	});
	if (!response.ok) {
		return { ok: false, errors: response.diagnostics.map(formatDiagnostic) };
	}

	const size = Buffer.byteLength(response.bundle, 'utf8') + Buffer.byteLength(response.pageShell ?? '', 'utf8');
	if (size > MAX_STORY_BUNDLE_BYTES) {
		return {
			ok: false,
			errors: [
				`The built app is ${Math.round(size / 1024)}KB; bundles are capped at ${MAX_STORY_BUNDLE_BYTES / 1024}KB. Move heavy data into queries instead of source files.`,
			],
		};
	}
	return { ok: true, app: toStoryApp(response.bundle, response.pageShell), entry: entry.path };
}

function toStoryApp(bundle: string, pageShell: string | null): StoryApp {
	return pageShell === null ? { kind: 'react', bundle } : { kind: 'html', bundle, pageShell };
}

function resolveEntry(sources: Record<string, string>): { ok: true; path: string } | { ok: false; errors: string[] } {
	const declared = declaredEntry(sources);
	if (declared.error) {
		return { ok: false, errors: [declared.error] };
	}
	if (declared.path) {
		if (!(declared.path in sources)) {
			return {
				ok: false,
				errors: [
					`${STORY_APP_MANIFEST_PATH} names "${declared.path}" as the entry, but that file does not exist.`,
				],
			};
		}
		return { ok: true, path: declared.path };
	}
	const candidate = STORY_APP_ENTRY_CANDIDATES.find((path) => path in sources);
	if (!candidate) {
		return {
			ok: false,
			errors: [
				`No entry file. Add ${STORY_APP_ENTRY_CANDIDATES.map((path) => `"${path}"`).join(' or ')} exporting the root component as default, or set "entry" in ${STORY_APP_MANIFEST_PATH} (a script, or an .html document).`,
			],
		};
	}
	return { ok: true, path: candidate };
}

/** The frame's content security policy would drop these silently, so the agent learns at build time instead. */
function remoteStylesheetErrors(files: StorySourceFile[]): string[] {
	return files
		.filter((file) => file.path.endsWith('.css'))
		.flatMap((file) => {
			return [...file.content.matchAll(REMOTE_STYLE_IMPORT)]
				.filter((match) => !isAllowedFontStylesheet(match[1]))
				.map((match) => {
					const line = file.content.slice(0, match.index).split('\n').length;
					return `${file.path}:${line} — @import of "${match[1]}" is blocked: stories only load their own CSS and theme fonts. Leaflet's CSS and the kit styles are already loaded; delete this line.`;
				});
		});
}

function declaredEntry(sources: Record<string, string>): { path?: string; error?: string } {
	const manifest = sources[STORY_APP_MANIFEST_PATH];
	if (manifest === undefined) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(manifest);
		const entry = typeof parsed === 'object' && parsed !== null ? (parsed as { entry?: unknown }).entry : undefined;
		if (entry !== undefined && typeof entry !== 'string') {
			return { error: `${STORY_APP_MANIFEST_PATH}: "entry" must be a string path relative to the story root.` };
		}
		return { path: entry };
	} catch (error) {
		return { error: `${STORY_APP_MANIFEST_PATH} is not valid JSON: ${(error as Error).message}` };
	}
}

function formatDiagnostic(diagnostic: StoryBuildDiagnostic): string {
	const location = diagnostic.file
		? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''} — `
		: '';
	const excerpt = diagnostic.lineText ? `\n    ${diagnostic.lineText.trim()}` : '';
	return `${location}${diagnostic.message}${excerpt}`;
}

/** The worker source is the function itself, so the compiled standalone binary needs no file on disk. */
const WORKER_SOURCE = `(${storyBuildWorker.toString()})()`;

function runBuildWorker(request: StoryBuildRequest): Promise<StoryBuildResponse> {
	return new Promise((resolve, reject) => {
		const child = spawn(bunExecutable(), ['--smol', '-e', WORKER_SOURCE], {
			env: { ...process.env, BUN_BE_BUN: '1', NODE_ENV: 'production' },
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: BUILD_TIMEOUT_MS,
			killSignal: 'SIGKILL',
		});

		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.on('error', (error) => reject(new Error(`Could not start the story build: ${error.message}`)));
		child.on('close', (code, signal) => {
			if (signal === 'SIGKILL') {
				reject(new Error(`The story build timed out after ${BUILD_TIMEOUT_MS / 1000}s.`));
				return;
			}
			if (code !== 0) {
				reject(new Error(`The story build crashed (exit ${code}). ${stderr.trim().slice(-STDERR_TAIL_CHARS)}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as StoryBuildResponse);
			} catch {
				reject(
					new Error(
						`The story build returned an unreadable result. ${stderr.trim().slice(-STDERR_TAIL_CHARS)}`,
					),
				);
			}
		});

		child.stdin.on('error', () => undefined);
		child.stdin.end(JSON.stringify(request));
	});
}

/** Under Bun the running binary is the runtime (also for `bun --compile` builds, via BUN_BE_BUN); elsewhere fall back to PATH. */
function bunExecutable(): string {
	return process.versions.bun ? process.execPath : 'bun';
}
