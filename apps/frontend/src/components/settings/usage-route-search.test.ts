import { describe, expect, it } from 'vitest';

import { validateUsageSearch } from './usage-route-search';

describe('validateUsageSearch', () => {
	it('accepts supported providers', () => {
		expect(validateUsageSearch({ provider: 'openai' }).provider).toBe('openai');
		expect(validateUsageSearch({ provider: 'all' }).provider).toBe('all');
	});

	it('rejects inherited provider label properties', () => {
		expect(validateUsageSearch({ provider: 'constructor' }).provider).toBe('all');
		expect(validateUsageSearch({ provider: 'toString' }).provider).toBe('all');
	});

	it('accepts context recommendations as a source', () => {
		expect(validateUsageSearch({ sources: ['contextRecommendations'] }).sources).toEqual([
			'contextRecommendations',
		]);
	});
});
