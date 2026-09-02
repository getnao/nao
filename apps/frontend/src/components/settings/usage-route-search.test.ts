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

	it('accepts valid custom usage periods', () => {
		expect(validateUsageSearch({ periodMode: 'custom', periodValue: '30', periodUnit: 'day' })).toMatchObject({
			periodMode: 'custom',
			periodValue: 30,
			periodUnit: 'day',
		});
	});

	it('rejects custom usage periods outside unit limits', () => {
		expect(validateUsageSearch({ periodMode: 'custom', periodValue: 25, periodUnit: 'hour' })).toMatchObject({
			periodMode: 'custom',
			periodValue: undefined,
			periodUnit: undefined,
		});
	});

	it('converts fixed and granularity period values', () => {
		expect(validateUsageSearch({ period: '30d' })).toMatchObject({
			periodMode: 'custom',
			periodValue: 30,
			periodUnit: 'day',
		});
		expect(validateUsageSearch({ granularity: 'hour' }).periodMode).toBe('24h');
		expect(validateUsageSearch({ granularity: 'day' }).periodMode).toBe('15d');
		expect(validateUsageSearch({ granularity: 'month' }).periodMode).toBe('6m');
	});
});
