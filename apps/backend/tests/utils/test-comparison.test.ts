import { describe, expect, it } from 'vitest';

import type { TestContextVariant } from '../../src/types/test-run';
import { compareContextVariants, listAddedTestPaths } from '../../src/utils/test-comparison';

describe('compareContextVariants', () => {
	it('classifies each test by how the draft changed its pass rate, regressions first', () => {
		const comparison = compareContextVariants(
			[
				...attempts('revenue', 'production', [false, false]),
				...attempts('revenue', 'draft', [true, true]),
				...attempts('orders', 'production', [true, true]),
				...attempts('orders', 'draft', [false, false]),
				...attempts('churn', 'production', [false, true]),
				...attempts('churn', 'draft', [true, true]),
				...attempts('margin', 'production', [true, true]),
				...attempts('margin', 'draft', [true, false]),
				...attempts('signups', 'production', [true, true]),
				...attempts('signups', 'draft', [true, true]),
			],
			2,
		);

		expect(comparison.tests.map((test) => [test.testName, test.change])).toEqual([
			['orders', 'regressed'],
			['margin', 'worsened'],
			['revenue', 'fixed'],
			['churn', 'improved'],
			['signups', 'unchanged'],
		]);
		expect(comparison.production).toEqual({ passedAttempts: 7, totalAttempts: 10 });
		expect(comparison.draft).toEqual({ passedAttempts: 7, totalAttempts: 10 });
	});

	it('keeps a test pending until both variants recorded all their attempts', () => {
		const comparison = compareContextVariants(
			[...attempts('revenue', 'production', [true, true]), ...attempts('revenue', 'draft', [false])],
			2,
		);

		expect(comparison.tests[0]).toMatchObject({
			change: 'pending',
			production: { passedAttempts: 2, totalAttempts: 2 },
			draft: { passedAttempts: 0, totalAttempts: 1 },
		});
	});
});

describe('compareContextVariants with tests the draft adds', () => {
	it('marks them new instead of pending, as they never run on production', () => {
		const comparison = compareContextVariants(
			[
				...attempts('revenue', 'production', [true]),
				...attempts('revenue', 'draft', [true]),
				...attempts('margin', 'draft', [false]),
			],
			1,
			new Set(['margin.yml']),
		);

		expect(comparison.tests.map((test) => [test.testName, test.change])).toEqual([
			['margin', 'new'],
			['revenue', 'unchanged'],
		]);
		expect(comparison.production).toEqual({ passedAttempts: 1, totalAttempts: 1 });
	});
});

describe('listAddedTestPaths', () => {
	it('keeps the test files the changes add, by their path in the tests folder', () => {
		const addedTestPaths = listAddedTestPaths([
			{ path: 'tests/finance/margin.yml', kind: 'added' },
			{ path: 'tests/revenue.yml', kind: 'modified' },
			{ path: 'tests/outputs/run.yml', kind: 'added' },
			{ path: 'docs/margin.md', kind: 'added' },
		]);

		expect([...addedTestPaths]).toEqual(['finance/margin.yml']);
	});
});

function attempts(testName: string, contextVariant: TestContextVariant, outcomes: boolean[]) {
	return outcomes.map((passed) => ({ testPath: `${testName}.yml`, testName, contextVariant, passed }));
}
