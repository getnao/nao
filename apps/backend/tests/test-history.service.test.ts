import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listRecentResultOutcomes: vi.fn() }));

vi.mock('../src/queries/test-run.queries', () => ({ listRecentResultOutcomes: mocks.listRecentResultOutcomes }));

import { getLatestOutcomesByTest } from '../src/services/test-history.service';
import type { TestDefinition } from '../src/types/test-run';

const LATEST_RUN_AT = new Date('2026-10-26T10:00:00Z');
const PREVIOUS_RUN_AT = new Date('2026-10-25T10:00:00Z');

describe('getLatestOutcomesByTest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('counts the attempts of the latest run that included each test', async () => {
		mocks.listRecentResultOutcomes.mockResolvedValue([
			outcomeRow('run-2', LATEST_RUN_AT, 'revenue.yml', 'hash-revenue', true),
			outcomeRow('run-2', LATEST_RUN_AT, 'revenue.yml', 'hash-revenue', false),
			outcomeRow('run-1', PREVIOUS_RUN_AT, 'revenue.yml', 'hash-revenue', true),
			outcomeRow('run-1', PREVIOUS_RUN_AT, 'orders.yml', 'hash-orders', true),
		]);

		const outcomes = await getLatestOutcomesByTest('project-1', [
			testDefinition('revenue.yml', 'hash-revenue'),
			testDefinition('orders.yml', 'hash-orders'),
		]);

		expect(outcomes).toEqual({
			'revenue.yml': {
				runId: 'run-2',
				runCreatedAt: LATEST_RUN_AT,
				passedAttempts: 1,
				totalAttempts: 2,
				isOutdated: false,
			},
			'orders.yml': {
				runId: 'run-1',
				runCreatedAt: PREVIOUS_RUN_AT,
				passedAttempts: 1,
				totalAttempts: 1,
				isOutdated: false,
			},
		});
	});

	it('flags outcomes of tests edited since, and ignores tests that no longer exist', async () => {
		mocks.listRecentResultOutcomes.mockResolvedValue([
			outcomeRow('run-1', LATEST_RUN_AT, 'revenue.yml', 'old-hash', true),
			outcomeRow('run-1', LATEST_RUN_AT, 'deleted.yml', 'hash-deleted', true),
		]);

		const outcomes = await getLatestOutcomesByTest('project-1', [testDefinition('revenue.yml', 'new-hash')]);

		expect(Object.keys(outcomes)).toEqual(['revenue.yml']);
		expect(outcomes['revenue.yml'].isOutdated).toBe(true);
	});
});

function outcomeRow(runId: string, runCreatedAt: Date, testPath: string, testHash: string, passed: boolean) {
	return { runId, runCreatedAt, testPath, testHash, passed };
}

function testDefinition(path: string, hash: string): TestDefinition {
	return {
		path,
		name: path,
		prompt: 'prompt',
		sql: null,
		databaseId: null,
		assertions: [],
		tags: [],
		owner: null,
		hash,
	};
}
