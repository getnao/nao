import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/queries/project.queries', () => ({ getAgentSettings: vi.fn() }));
vi.mock('../../src/queries/story.queries', () => ({ getStoryProjectId: vi.fn() }));
vi.mock('../../src/utils/safe-fetch', () => ({ safeFetchBytes: vi.fn() }));

import * as projectQueries from '../../src/queries/project.queries';
import { readStoryImages } from '../../src/services/story-image';
import * as safeFetchModule from '../../src/utils/safe-fetch';

const PNG_BYTES = Buffer.from('png');

function allowSources(...allowedSources: string[]): void {
	vi.mocked(projectQueries.getAgentSettings).mockResolvedValue({ storyImages: { allowedSources } });
}

function servesImage(contentType: string | undefined, url?: string): void {
	vi.mocked(safeFetchModule.safeFetchBytes).mockImplementation(async (src) => ({
		bytes: PNG_BYTES,
		contentType,
		url: url ?? src,
	}));
}

describe('readStoryImages', () => {
	beforeEach(() => {
		allowSources('https://cdn.acme.com/brand');
		servesImage('image/png');
	});

	it('returns an allowed https image as a data URL', async () => {
		const results = await readStoryImages('project', ['https://cdn.acme.com/brand/logo.png']);
		expect(results).toEqual({
			'https://cdn.acme.com/brand/logo.png': { dataUri: `data:image/png;base64,${PNG_BYTES.toString('base64')}` },
		});
	});

	it('falls back to the file extension when the host serves a generic media type', async () => {
		servesImage('application/octet-stream');
		const results = await readStoryImages('project', ['https://cdn.acme.com/brand/logo.webp']);
		expect(results['https://cdn.acme.com/brand/logo.webp']).toEqual({
			dataUri: expect.stringMatching(/^data:image\/webp;base64,/),
		});
	});

	it.each([
		[
			'a source outside the allowlist',
			'https://cdn.acme.com/finance/q3.png',
			undefined,
			'image/png',
			/not allowed/,
		],
		[
			'a redirect off the allowlist',
			'https://cdn.acme.com/brand/logo.png',
			'https://evil.com/logo.png',
			'image/png',
			/redirected/,
		],
		[
			'a file that is not an image',
			'https://cdn.acme.com/brand/report.csv',
			undefined,
			'text/csv',
			/not a supported image/,
		],
	])('refuses %s', async (_case, src, redirectedUrl, contentType, message) => {
		servesImage(contentType, redirectedUrl);
		const result = (await readStoryImages('project', [src]))[src];
		expect(result).toEqual({ error: expect.stringMatching(message) });
	});

	it('stops reading once the request has loaded its budget of large images', async () => {
		const largeImage = Buffer.alloc(4 * 1024 * 1024);
		vi.mocked(safeFetchModule.safeFetchBytes)
			.mockClear()
			.mockImplementation(async (src) => ({
				bytes: largeImage,
				contentType: 'image/png',
				url: src,
			}));
		const sources = Array.from({ length: 9 }, (_, index) => `https://cdn.acme.com/brand/${index}.png`);
		const results = await readStoryImages('project', sources);
		expect(safeFetchModule.safeFetchBytes).toHaveBeenCalledTimes(6);
		expect(results[sources[8]]).toEqual({ error: expect.stringContaining('Too many large images') });
	});

	it('refuses a bucket the project allows but the operator does not, without reading it', async () => {
		allowSources('gs://other-tenant');
		const result = (await readStoryImages('project', ['gs://other-tenant/logo.png']))['gs://other-tenant/logo.png'];
		expect(result).toEqual({ error: expect.stringMatching(/not allowed/) });
	});
});
