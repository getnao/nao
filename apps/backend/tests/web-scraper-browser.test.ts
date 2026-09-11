import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { describe, expect, it } from 'vitest';

import { runWebRobotRecipe } from '../src/services/web-scraper/runner';
import { findChromePath } from '../src/utils/headless-browser';

const chromePath = (() => {
	try {
		return findChromePath();
	} catch {
		return null;
	}
})();
const enabled = chromePath !== null && process.env.WEB_ROBOT_BROWSER_TESTS === '1';

describe.skipIf(!enabled)('web robot browser integration', () => {
	it('loads and extracts a real browser-rendered page', async () => {
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, timeoutMs: 30_000, retries: 0 },
			limits: { maxPages: 1, maxItems: 1, maxRequests: 100, maxDurationMs: 60_000 },
			stages: [
				{
					id: 'page',
					source: {
						type: 'browser',
						url: 'https://example.com',
						actions: [{ type: 'waitForSelector', selector: 'h1', timeoutMs: 15_000 }],
					},
					extract: {
						type: 'dom',
						fields: {
							name: { selector: 'h1', required: true },
							url: { selector: 'link[rel=canonical]', attr: 'href', default: 'https://example.com' },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe, runId: 'browser-smoke' });

		expect(result.products).toHaveLength(1);
		expect(result.products[0]?.name).toBe('Example Domain');
		expect(result.stats.failedRequests).toBe(0);
	}, 60_000);
});
