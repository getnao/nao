// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
	DEFAULT_USAGE_SEARCH,
	readStoredUsagePeriodPreference,
	saveUsageFilters,
	validateUsageSearch,
	validateUsageSearchWithStoredFilters,
} from './usage-route-search';

describe('validateUsageSearch', () => {
	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-a'));
	});

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

	it('ignores removed custom period parameters', () => {
		expect(
			validateUsageSearch({ periodMode: 'custom', periodValue: 30, periodUnit: 'day' }).periodMode,
		).toBeUndefined();
	});

	it('accepts a saved period entry id', () => {
		expect(validateUsageSearch({ periodEntryId: 'last-year' }).periodEntryId).toBe('last-year');
		expect(validateUsageSearch({ periodEntryId: '' }).periodEntryId).toBeUndefined();
	});

	it('converts fixed and granularity period values', () => {
		expect(validateUsageSearch({ period: '30d' }).periodMode).toBeUndefined();
		expect(validateUsageSearch({ granularity: 'hour' }).periodMode).toBe('24h');
		expect(validateUsageSearch({ granularity: 'day' }).periodMode).toBe('15d');
		expect(validateUsageSearch({ granularity: 'month' }).periodMode).toBe('6m');
	});

	it('keeps stored periods for migration without applying them to route state', () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ provider: 'openai', periodMode: '6m' }));

		expect(validateUsageSearchWithStoredFilters({})).toMatchObject({
			provider: 'openai',
			periodMode: undefined,
		});
		expect(readStoredUsagePeriodPreference('project-a')).toEqual({ mode: '6m' });
	});

	it('preserves a legacy period while saving other filters', () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));

		saveUsageFilters({ ...DEFAULT_USAGE_SEARCH, provider: 'openai' });

		expect(readStoredUsagePeriodPreference('project-a')).toEqual({ mode: '6m' });
		expect(JSON.parse(localStorage.getItem('nao.usage-filters.project-a') ?? '{}')).toMatchObject({
			provider: 'openai',
			periodMode: '6m',
		});
	});
});
