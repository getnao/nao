import { STORY_DOCUMENT_SLOTS } from '@nao/shared/story-app';
import { describe, expect, it } from 'vitest';

import { buildStoryApp, type StoryBuildResult } from '../src/services/story-app-build';

const pageShellOf = (result: StoryBuildResult): string | null => {
	return result.ok && result.app.kind === 'html' ? result.app.pageShell : null;
};

describe('buildStoryApp entry', () => {
	it('builds an entry that default-exports a component', async () => {
		const result = await buildStoryApp([
			{ path: 'app.jsx', content: 'export default function App() { return null; }' },
		]);

		expect(result.ok && result.app).toEqual({ kind: 'react', bundle: expect.any(String) });
	});

	it('refuses an entry without a default export', async () => {
		const result = await buildStoryApp([{ path: 'app.jsx', content: 'export const App = () => null;' }]);

		expect(result).toEqual({
			ok: false,
			errors: [expect.stringContaining('must default-export the root React component')],
		});
	});

	it('refuses a non-script entry named in nao.json', async () => {
		const result = await buildStoryApp([
			{ path: 'nao.json', content: '{"entry": "styles.css"}' },
			{ path: 'styles.css', content: 'body { color: red; }' },
		]);

		expect(result).toEqual({
			ok: false,
			errors: [expect.stringContaining('must be a .jsx, .tsx, .js or .ts file')],
		});
	});

	it('does not guess an html entry without nao.json', async () => {
		const result = await buildStoryApp([
			{ path: 'index.html', content: '<html><head></head><body></body></html>' },
		]);

		expect(result).toEqual({ ok: false, errors: [expect.stringContaining('No entry file')] });
	});
});

describe('buildStoryApp html entry', () => {
	const manifest = { path: 'nao.json', content: '{"entry": "index.html"}' };

	it('moves inline and local scripts into the bundle and strips host-owned tags', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content: [
					'<!doctype html><html><head><meta charset="utf-8">',
					'<meta http-equiv="Content-Security-Policy" content="default-src *">',
					'<base href="https://evil.example/">',
					'<link rel="stylesheet" href="./page.css">',
					'<script type="importmap">{"imports":{}}</script>',
					'</head><body><h1>Report</h1>',
					'<script type="application/json" id="seed">{"kept":true}</script>',
					'<script>document.title = "inline one";</script>',
					'<script type="module" src="./main.js"></script>',
					'</body></html>',
				].join('\n'),
			},
			{ path: 'page.css', content: 'h1 { color: red; }' },
			{ path: 'main.js', content: 'export const fromMain = nao.theme();' },
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.entry).toBe('index.html');
		const { bundle } = result.app;
		const pageShell = pageShellOf(result);
		expect(pageShell).toContain('<h1>Report</h1>');
		expect(pageShell).toContain('id="seed"');
		expect(pageShell).not.toContain('Content-Security-Policy');
		expect(pageShell).not.toContain('<base');
		expect(pageShell).not.toContain('page.css');
		expect(pageShell).not.toContain('importmap');
		expect(pageShell).not.toContain('inline one');
		expect(bundle).toContain('inline one');
		expect(bundle).toContain('fromMain');
		expect(bundle.indexOf('inline one')).toBeLessThan(bundle.indexOf('fromMain'));
	});

	it('wraps a fragment into a full document', async () => {
		const result = await buildStoryApp([manifest, { path: 'index.html', content: '<h1>Only a heading</h1>' }]);

		expect(pageShellOf(result)).toMatch(
			/<head>[\s\S]*<\/head>[\s\S]*<body>[\s\S]*<h1>Only a heading<\/h1>[\s\S]*<\/body>/,
		);
	});

	it('refuses remote scripts', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content: '<html><head></head><body><script src="https://cdn.example/lib.js"></script></body></html>',
			},
		]);

		expect(result).toEqual({ ok: false, errors: [expect.stringContaining('is not available to stories')] });
	});

	it('refuses scripts pointing at files the story does not have', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content: '<html><head></head><body><script src="./missing.js"></script></body></html>',
			},
		]);

		expect(result).toEqual({ ok: false, errors: [expect.stringContaining('does not point to a')] });
	});

	it('applies the import allowlist to html scripts', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content: '<html><head></head><body><script type="module">import "lodash";</script></body></html>',
			},
		]);

		expect(result).toEqual({
			ok: false,
			errors: [expect.stringContaining('index.html (inline script #1)')],
		});
	});

	it('places the host slots first in <head> and last in <body>, without the document comments', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content:
					'<!-- <head> --><!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>',
			},
		]);

		expect(pageShellOf(result)).toBe(
			`<!doctype html><html><head>${STORY_DOCUMENT_SLOTS.head}<title>T</title></head><body><p>x</p>${STORY_DOCUMENT_SLOTS.body}</body></html>`,
		);
	});

	it('refuses content before <head>, where the host policy would be ignored', async () => {
		const result = await buildStoryApp([
			manifest,
			{ path: 'index.html', content: '<html><img src="x"><head></head><body></body></html>' },
		]);

		expect(result).toEqual({ ok: false, errors: [expect.stringContaining('content before <head>')] });
	});

	it('refuses inline event handlers, which the frame never runs', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content: '<html><head></head><body><button onclick="go()">Go</button></body></html>',
			},
		]);

		expect(result).toEqual({ ok: false, errors: [expect.stringContaining('addEventListener')] });
	});

	it('resolves inline script imports from the entry folder', async () => {
		const result = await buildStoryApp([
			{ path: 'nao.json', content: '{"entry": "pages/index.html"}' },
			{
				path: 'pages/index.html',
				content: '<html><head></head><body><script type="module">import "./chart.js";</script></body></html>',
			},
			{ path: 'pages/chart.js', content: 'document.title = "from chart";' },
		]);

		expect(result.ok && result.app.bundle).toContain('from chart');
	});

	it('refuses remote stylesheets other than font providers', async () => {
		const result = await buildStoryApp([
			manifest,
			{
				path: 'index.html',
				content:
					'<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://cdn.example/app.css"></head><body></body></html>',
			},
		]);

		expect(result).toEqual({
			ok: false,
			errors: [expect.stringContaining('<link href="https://cdn.example/app.css"> is blocked')],
		});
	});

	it('refuses imports that climb above the story root', async () => {
		const result = await buildStoryApp([
			{ path: 'nao.json', content: '{"entry": "pages/index.html"}' },
			{
				path: 'pages/index.html',
				content: '<html><head></head><body><script type="module">import "../../lib.js";</script></body></html>',
			},
			{ path: 'lib.js', content: 'document.title = "from root";' },
		]);

		expect(result.ok).toBe(false);
	});
});
