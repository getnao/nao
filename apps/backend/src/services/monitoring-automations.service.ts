import { NAO_EVENT_TYPES } from '@nao/shared/types';

import type { ProjectAutomationSummary } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import type { AutomationRunRecord } from '../queries/monitoring-automations.queries';
import * as monitoringAutomationQueries from '../queries/monitoring-automations.queries';
import { AUTOMATION_RUN_STATUSES } from '../types/automation';
import type {
	AutomationMonitoringRow,
	AutomationRunFailure,
	AutomationRunsBucket,
	AutomationRunTriggerKey,
	AutomationsKpis,
	AutomationsMonitoring,
	MonitoringRange,
} from '../types/monitoring';
import {
	durationBetween,
	isInCurrentPeriod,
	listBucketKeys,
	type MonitoringWindow,
	percentile,
	ratio,
	resolveMonitoringWindow,
	toBucketKey,
} from '../utils/monitoring-stats';

const RECENT_FAILURE_LIMIT = 10;
const MEDIAN = 0.5;
const P95 = 0.95;

/** How the project's automations ran over the range: volumes, failures, triggers and durations. */
export async function getAutomationsMonitoring(
	projectId: string,
	range: MonitoringRange,
): Promise<AutomationsMonitoring> {
	const window = resolveMonitoringWindow(range);
	const automations = await automationQueries.listProjectAutomations(projectId);
	const runs = await monitoringAutomationQueries.listProjectAutomationRunsSince(projectId, window.previousSince);
	const currentRuns = runs.filter((run) => isInCurrentPeriod(run.startedAt, window));
	const previousRuns = runs.filter((run) => run.startedAt < window.since);

	return {
		kpis: buildKpis(currentRuns, previousRuns, automations),
		runsOverTime: buildRunsOverTime(currentRuns, window),
		triggers: countTriggers(currentRuns),
		automations: buildAutomationRows(automations, currentRuns),
		recentFailures: listRecentFailures(currentRuns),
	};
}

function buildKpis(
	currentRuns: AutomationRunRecord[],
	previousRuns: AutomationRunRecord[],
	automations: ProjectAutomationSummary[],
): AutomationsKpis {
	const durations = listDurations(currentRuns);
	return {
		runs: { current: currentRuns.length, previous: previousRuns.length },
		failedRuns: { current: countFailed(currentRuns), previous: countFailed(previousRuns) },
		successRate: { current: successRate(currentRuns), previous: successRate(previousRuns) },
		durationP50Ms: percentile(durations, MEDIAN),
		durationP95Ms: percentile(durations, P95),
		activeAutomations: automations.filter(isAutomationActive).length,
		totalAutomations: automations.length,
	};
}

function buildRunsOverTime(runs: AutomationRunRecord[], window: MonitoringWindow): AutomationRunsBucket[] {
	const buckets = new Map(listBucketKeys(window).map((bucket) => [bucket, emptyBucket(bucket)]));
	for (const run of runs) {
		const bucket = buckets.get(toBucketKey(run.startedAt, window.range));
		if (bucket) {
			bucket[run.status] += 1;
		}
	}
	return [...buckets.values()];
}

function countTriggers(runs: AutomationRunRecord[]): AutomationsMonitoring['triggers'] {
	const counts = new Map<AutomationRunTriggerKey, number>();
	for (const run of runs) {
		const trigger = run.trigger ?? 'unknown';
		counts.set(trigger, (counts.get(trigger) ?? 0) + 1);
	}
	return [...counts].map(([trigger, count]) => ({ trigger, count })).sort((left, right) => right.count - left.count);
}

/** Every automation of the project, including those that did not run, most failing first. */
function buildAutomationRows(
	automations: ProjectAutomationSummary[],
	runs: AutomationRunRecord[],
): AutomationMonitoringRow[] {
	const runsByAutomation = groupRunsByAutomation(runs);
	return automations
		.map((automation) => buildAutomationRow(automation, runsByAutomation.get(automation.id) ?? []))
		.sort((left, right) => right.failedRuns - left.failedRuns || right.runs - left.runs);
}

function groupRunsByAutomation(runs: AutomationRunRecord[]): Map<string, AutomationRunRecord[]> {
	const groups = new Map<string, AutomationRunRecord[]>();
	for (const run of runs) {
		const group = groups.get(run.automationId);
		if (group) {
			group.push(run);
		} else {
			groups.set(run.automationId, [run]);
		}
	}
	return groups;
}

function buildAutomationRow(
	automation: ProjectAutomationSummary,
	runs: AutomationRunRecord[],
): AutomationMonitoringRow {
	const failedRuns = countFailed(runs);
	return {
		id: automation.id,
		title: automation.title,
		owner: automation.owner ? { id: automation.owner.id, name: automation.owner.name } : null,
		isActive: isAutomationActive(automation),
		runs: runs.length,
		failedRuns,
		failureRate: ratio(failedRuns, runs.length),
		durationP50Ms: percentile(listDurations(runs), MEDIAN),
		lastRun:
			automation.lastRunStatus && automation.lastRunStartedAt
				? { status: automation.lastRunStatus, startedAt: automation.lastRunStartedAt }
				: null,
	};
}

function listRecentFailures(runs: AutomationRunRecord[]): AutomationRunFailure[] {
	return runs
		.filter((run) => run.status === 'failed')
		.reverse()
		.slice(0, RECENT_FAILURE_LIMIT)
		.map((run) => ({
			runId: run.id,
			automationId: run.automationId,
			automationTitle: run.automationTitle,
			trigger: run.trigger ?? 'unknown',
			startedAt: run.startedAt,
			errorMessage: run.errorMessage,
			chatId: run.chatId,
		}));
}

/** Scheduled automations are switched on and off by their schedule; others by their webhook and nao events. */
function isAutomationActive(automation: ProjectAutomationSummary): boolean {
	if (automation.cron) {
		return automation.enabled;
	}
	return (
		automation.webhookEnabled || NAO_EVENT_TYPES.some((eventType) => automation.eventTriggers[eventType]?.enabled)
	);
}

function successRate(runs: AutomationRunRecord[]): number | null {
	const completed = runs.filter((run) => run.status === 'completed').length;
	const finished = completed + countFailed(runs);
	return finished > 0 ? completed / finished : null;
}

function countFailed(runs: AutomationRunRecord[]): number {
	return runs.filter((run) => run.status === 'failed').length;
}

function listDurations(runs: AutomationRunRecord[]): number[] {
	return runs
		.filter((run) => run.status === 'completed' || run.status === 'failed')
		.map((run) => durationBetween(run.startedAt, run.completedAt))
		.filter((duration): duration is number => duration !== null);
}

function emptyBucket(bucket: string): AutomationRunsBucket {
	return {
		bucket,
		...Object.fromEntries(AUTOMATION_RUN_STATUSES.map((status) => [status, 0])),
	} as AutomationRunsBucket;
}
