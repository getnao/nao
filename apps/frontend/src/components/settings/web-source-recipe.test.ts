import { describe, expect, it } from 'vitest';

import {
	DEFAULT_WEB_SOURCE_RECIPE_TEXT,
	parseBrowserActions,
	parseBrowserCaptures,
	parseWebSourceRecipe,
	recipeSummary,
	schedulePresetForCron,
	slugifyWebSourceName,
	webRobotRunBadgeVariant,
} from './web-source-recipe';

describe('web source recipe helpers', () => {
	it('parses the default recipe', () => {
		const result = parseWebSourceRecipe(DEFAULT_WEB_SOURCE_RECIPE_TEXT);
		expect(result.errors).toEqual([]);
		expect(result.recipe?.stages).toHaveLength(1);
		expect(result.recipe?.stages[0]?.output).toBe('product');
		expect(recipeSummary(result.recipe)?.sourceTypes).toEqual(['api']);
	});

	it('reports JSON and schema errors separately', () => {
		expect(parseWebSourceRecipe('{').errors[0]).toMatch(/^JSON:/);

		const invalid = parseWebSourceRecipe('{"version":1,"allowedHosts":[],"stages":[]}');
		expect(invalid.recipe).toBeUndefined();
		expect(invalid.errors.some((error) => error.includes('allowedHosts'))).toBe(true);
	});

	it('parses browser actions and captures', () => {
		expect(parseBrowserActions('[{"type":"delay","ms":250}]').actions).toEqual([{ type: 'delay', ms: 250 }]);
		expect(parseBrowserCaptures('[{"name":"api","urlPattern":"/products","body":"json"}]').captures).toEqual([
			{ name: 'api', urlPattern: '/products', body: 'json' },
		]);
		expect(parseBrowserActions('[{"type":"unknown"}]').errors).toHaveLength(1);
	});

	it('maps common cron presets and slugs', () => {
		expect(schedulePresetForCron('')).toBe('manual');
		expect(schedulePresetForCron('0 2 * * *')).toBe('daily');
		expect(schedulePresetForCron('0 2 * * 1')).toBe('weekly');
		expect(schedulePresetForCron('*/15 * * * *')).toBe('custom');
		expect(slugifyWebSourceName(' Deublin Products! ')).toBe('deublin-products');
	});

	it('maps run states to badge variants', () => {
		expect(webRobotRunBadgeVariant('completed')).toBe('success');
		expect(webRobotRunBadgeVariant('partial')).toBe('context_admin');
		expect(webRobotRunBadgeVariant('failed')).toBe('destructive');
		expect(webRobotRunBadgeVariant('running')).toBe('secondary');
	});
});
