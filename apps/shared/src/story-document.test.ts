import { describe, expect, it } from 'vitest';

import { STORY_DOCUMENT_SLOTS, type StoryApp } from './story-app';
import { composeStoryDocument } from './story-document';

const parts = { head: '<meta name="host">', body: '<script>boot()</script>' };
const { head, body } = STORY_DOCUMENT_SLOTS;

const htmlApp = (pageShell: string): StoryApp => ({ kind: 'html', bundle: '', pageShell });

describe('composeStoryDocument', () => {
	it('builds the host skeleton with a root for a React story', () => {
		const html = composeStoryDocument({ kind: 'react', bundle: '' }, parts);

		expect(html).toContain('<head>\n<meta name="host">\n</head>');
		expect(html).toContain('<div id="root"></div>\n<script>boot()</script>\n</body>');
	});

	it('fills the slots the build placed in an HTML story', () => {
		const html = composeStoryDocument(
			htmlApp(
				`<!doctype html><html lang="en"><head class="x">${head}<title>T</title></head><body><h1>Hi</h1>${body}</body></html>`,
			),
			parts,
		);

		expect(html).toBe(
			'<!doctype html><html lang="en"><head class="x"><meta name="host"><title>T</title></head><body><h1>Hi</h1><script>boot()</script></body></html>',
		);
	});

	it('keeps replacement patterns in the host parts literal', () => {
		const html = composeStoryDocument(htmlApp(`<html><head>${head}</head><body>${body}</body></html>`), {
			head: '$&$1',
			body: "$'",
		});

		expect(html).toContain('$&$1');
		expect(html).toContain("$'");
	});

	it('fails closed when a slot is missing or repeated', () => {
		expect(() => composeStoryDocument(htmlApp('<html><head></head><body></body></html>'), parts)).toThrow(
			'Publish it again',
		);
		expect(() =>
			composeStoryDocument(htmlApp(`<html><head>${head}</head><body>${head}${body}</body></html>`), parts),
		).toThrow('Publish it again');
	});
});
