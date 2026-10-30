import { describe, expect, it } from 'vitest';

import type { TestContextVariant } from '../src/types/test-run';
import { compareContextVariants } from '../src/utils/test-comparison';

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
		expect(comparison.production).toEqual({ passed: 7, total: 10 });
		expect(comparison.draft).toEqual({ passed: 7, total: 10 });
		expect(comparison.counts).toMatchObject({ regressed: 1, worsened: 1, fixed: 1, improved: 1, unchanged: 1 });
	});

	it('keeps a test pending until both variants recorded all their attempts', () => {
		const comparison = compareContextVariants(
			[...attempts('revenue', 'production', [true, true]), ...attempts('revenue', 'draft', [false])],
			2,
		);

		expect(comparison.tests[0]).toMatchObject({
			change: 'pending',
			production: { passed: 2, total: 2 },
			draft: { passed: 0, total: 1 },
		});
		expect(comparison.counts.pending).toBe(1);
	});
});

function attempts(testName: string, contextVariant: TestContextVariant, outcomes: boolean[]) {
	return outcomes.map((passed) => ({ testPath: `${testName}.yml`, testName, contextVariant, passed }));
}
