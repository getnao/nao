import { describe, expect, it } from 'vitest';

import {
	consumeHistoricalContextDiffSearch,
	getHistoricalContextDiffTarget,
	parseContextExplorerCommit,
	parseContextExplorerPath,
	validateContextExplorerSearch,
} from './context-explorer-search';

describe('context explorer search', () => {
	it('keeps a safe file path for initial selection', () => {
		expect(validateContextExplorerSearch({ path: '/models/revenue.sql' })).toEqual({
			path: '/models/revenue.sql',
		});
		expect(parseContextExplorerPath('/RULES.md')).toBe('/RULES.md');
	});

	it.each([undefined, '', 'RULES.md', '/../RULES.md', '/folder/../RULES.md', '/folder\\RULES.md'])(
		'ignores unsafe or invalid path %s',
		(path) => {
			expect(validateContextExplorerSearch({ path })).toEqual({});
		},
	);

	it('keeps a complete historical diff target and consumes its transient commits', () => {
		const search = validateContextExplorerSearch({
			path: '/models/revenue.sql',
			from: 'a'.repeat(40),
			to: 'B'.repeat(64),
		});

		expect(getHistoricalContextDiffTarget(search)).toEqual({
			path: '/models/revenue.sql',
			from: 'a'.repeat(40),
			to: 'B'.repeat(64),
		});
		expect(consumeHistoricalContextDiffSearch(search)).toEqual({ path: '/models/revenue.sql' });
	});

	it.each(['abc1234', 'g'.repeat(40), 'a'.repeat(39), 'a'.repeat(65), undefined])(
		'ignores invalid historical commit %s',
		(commit) => {
			expect(parseContextExplorerCommit(commit)).toBeUndefined();
			expect(
				validateContextExplorerSearch({
					path: '/RULES.md',
					from: commit,
					to: 'b'.repeat(40),
				}),
			).toEqual({ path: '/RULES.md' });
		},
	);

	it('keeps where the Tests drawer is, with or without an open file', () => {
		expect(validateContextExplorerSearch({ testRun: 'run-1' })).toEqual({ testRun: 'run-1' });
		expect(
			validateContextExplorerSearch({ path: '/RULES.md', test: '/tests/revenue.yml', testRun: 'run-2' }),
		).toEqual({
			path: '/RULES.md',
			test: '/tests/revenue.yml',
			testRun: 'run-2',
		});
	});

	it.each([
		[{ test: '/tests/../RULES.md' }, {}],
		[{ test: 'tests/revenue.yml', testRun: 'run-1' }, { testRun: 'run-1' }],
		[{ test: '/tests/revenue.yml', testRun: '../run' }, { test: '/tests/revenue.yml' }],
	])('ignores an invalid Tests drawer location %o', (search, expected) => {
		expect(validateContextExplorerSearch(search)).toEqual(expected);
	});

	it('keeps the Tests drawer location when consuming a historical diff', () => {
		const search = validateContextExplorerSearch({
			path: '/RULES.md',
			from: 'a'.repeat(40),
			to: 'b'.repeat(40),
			test: '/tests/revenue.yml',
		});

		expect(consumeHistoricalContextDiffSearch(search)).toEqual({ path: '/RULES.md', test: '/tests/revenue.yml' });
	});

	it('does not activate a partial historical range', () => {
		const search = validateContextExplorerSearch({
			path: '/RULES.md',
			from: 'a'.repeat(40),
		});

		expect(search).toEqual({ path: '/RULES.md' });
		expect(getHistoricalContextDiffTarget(search)).toBeNull();
	});
});
