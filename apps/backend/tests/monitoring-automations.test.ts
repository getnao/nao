import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listProjectAutomations: vi.fn(),
	listProjectAutomationRunsSince: vi.fn(),
}));

vi.mock('../src/queries/automation.queries', () => ({ listProjectAutomations: mocks.listProjectAutomations }));
vi.mock('../src/queries/monitoring-automations.queries', () => ({
	listProjectAutomationRunsSince: mocks.listProjectAutomationRunsSince,
}));

import { getAutomationsMonitoring } from '../src/services/monitoring-automations.service';

const NOW = new Date('2026-11-10T12:00:00Z');
const HOUR_MS = 60 * 60_000;

function automation(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Automation ${id}`,
		scheduleDescription: null,
		webhookEnabled: false,
		eventTriggers: {},
		cron: '0 9 * * *',
		enabled: true,
		lastRunStatus: null,
		lastRunStartedAt: null,
		owner: { id: 'owner-id', name: 'Owner', email: 'owner@example.com' },
		...overrides,
	};
}

function run(automationId: string, hoursAgo: number, overrides: Record<string, unknown> = {}) {
	const startedAt = new Date(NOW.getTime() - hoursAgo * HOUR_MS);
	return {
		id: `${automationId}-${hoursAgo}`,
		automationId,
		automationTitle: `Automation ${automationId}`,
		status: 'completed',
		trigger: 'schedule',
		startedAt,
		completedAt: new Date(startedAt.getTime() + 60_000),
		errorMessage: null,
		chatId: `chat-${hoursAgo}`,
		...overrides,
	};
}

describe('getAutomationsMonitoring', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('summarizes runs over the range against the previous period', async () => {
		mocks.listProjectAutomations.mockResolvedValue([
			automation('daily'),
			automation('paused', { enabled: false }),
			automation('on-feedback', {
				cron: '',
				enabled: false,
				eventTriggers: { feedback: { enabled: true, votes: ['down'], sources: ['story'] } },
			}),
		]);
		mocks.listProjectAutomationRunsSince.mockResolvedValue([
			run('daily', 30),
			run('daily', 5),
			run('daily', 3, { status: 'failed', errorMessage: 'Slack is down', completedAt: null }),
			run('on-feedback', 2, { trigger: 'feedback' }),
			run('on-feedback', 1, { trigger: null, status: 'running', completedAt: null }),
		]);

		const monitoring = await getAutomationsMonitoring('project-id', '24h');

		expect(mocks.listProjectAutomationRunsSince).toHaveBeenCalledWith(
			'project-id',
			new Date(NOW.getTime() - 48 * HOUR_MS),
		);
		expect(monitoring.kpis).toEqual({
			runs: { current: 4, previous: 1 },
			failedRuns: { current: 1, previous: 0 },
			successRate: { current: 2 / 3, previous: 1 },
			durationP50Ms: 60_000,
			durationP95Ms: 60_000,
			activeAutomations: 2,
			totalAutomations: 3,
		});
		expect(monitoring.triggers).toEqual([
			{ trigger: 'schedule', count: 2 },
			{ trigger: 'feedback', count: 1 },
			{ trigger: 'unknown', count: 1 },
		]);
		expect(monitoring.runsOverTime.reduce((total, bucket) => total + bucket.failed, 0)).toBe(1);
		expect(monitoring.recentFailures).toEqual([
			expect.objectContaining({ automationId: 'daily', errorMessage: 'Slack is down', trigger: 'schedule' }),
		]);
	});

	it('lists every automation, the most failing first', async () => {
		mocks.listProjectAutomations.mockResolvedValue([automation('quiet'), automation('flaky')]);
		mocks.listProjectAutomationRunsSince.mockResolvedValue([
			run('flaky', 4),
			run('flaky', 2, { status: 'failed' }),
		]);

		const { automations } = await getAutomationsMonitoring('project-id', '7d');

		expect(
			automations.map(({ id, runs, failedRuns, failureRate }) => ({ id, runs, failedRuns, failureRate })),
		).toEqual([
			{ id: 'flaky', runs: 2, failedRuns: 1, failureRate: 0.5 },
			{ id: 'quiet', runs: 0, failedRuns: 0, failureRate: 0 },
		]);
	});
});
