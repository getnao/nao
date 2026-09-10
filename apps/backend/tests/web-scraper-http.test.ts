import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/web-scraper/url-policy', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/services/web-scraper/url-policy')>();
	return {
		...actual,
		assertPublicHttpUrl: vi.fn(async (value: string) => new URL(value)),
	};
});

import { webRobotRecipeSchema } from '@nao/shared/web-robot';

import { loadHttpSource } from '../src/services/web-scraper/http-loader';

const recipe = webRobotRecipeSchema.parse({
	version: 1,
	allowedHosts: ['example.com', 'cdn.example.com'],
	respectRobotsTxt: false,
	stages: [
		{
			id: 'products',
			source: { type: 'http', url: 'https://example.com/products' },
			output: 'product',
		},
	],
});

describe('web robot HTTP loader', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not forward sensitive headers across redirect origins', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: 'https://cdn.example.com/products' },
				}),
			)
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const loaded = await loadHttpSource(
			{
				type: 'http',
				url: 'https://example.com/products',
				method: 'GET',
				headers: {
					authorization: { env: 'WEB_ROBOT_TOKEN' },
					'x-requested-with': 'nao',
				},
			},
			{ recipe, scope: {}, env: { WEB_ROBOT_TOKEN: 'secret' } },
		);

		expect(loaded.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'secret' });
		expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({ 'x-requested-with': 'nao' });
	});
});
