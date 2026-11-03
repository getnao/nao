import { describe, expect, it } from 'vitest';

import { matchesResultFilter } from './test-result-filter';

describe('matchesResultFilter', () => {
	it('counts a test as passed only once all its expected attempts passed', () => {
		const running = { passedAttempts: 2, totalAttempts: 2, expectedAttempts: 4 };
		const done = { passedAttempts: 4, totalAttempts: 4, expectedAttempts: 4 };

		expect(matchesResultFilter(running, 'passed')).toBe(false);
		expect(matchesResultFilter(running, 'failed')).toBe(false);
		expect(matchesResultFilter(done, 'passed')).toBe(true);
	});

	it('counts a test as failed as soon as one attempt failed', () => {
		const outcome = { passedAttempts: 1, totalAttempts: 2, expectedAttempts: 4 };

		expect(matchesResultFilter(outcome, 'failed')).toBe(true);
		expect(matchesResultFilter(outcome, 'passed')).toBe(false);
	});

	it('leaves a test without attempts in "All" only', () => {
		const outcome = { passedAttempts: 0, totalAttempts: 0, expectedAttempts: 0 };

		expect(matchesResultFilter(outcome, 'all')).toBe(true);
		expect(matchesResultFilter(outcome, 'passed')).toBe(false);
		expect(matchesResultFilter(outcome, 'failed')).toBe(false);
	});
});
