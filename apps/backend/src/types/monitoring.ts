import type { AutomationRunStatus, AutomationRunTrigger } from './automation';

export const MONITORING_RANGES = ['24h', '7d', '30d'] as const;
export type MonitoringRange = (typeof MONITORING_RANGES)[number];

/** Runs from before triggers were recorded count as unknown. */
export type AutomationRunTriggerKey = AutomationRunTrigger | 'unknown';

/** A value over the selected range, and over the equal-length period right before it. */
export interface PeriodValue<T> {
	current: T;
	previous: T;
}

export interface AutomationsMonitoring {
	kpis: AutomationsKpis;
	runsOverTime: AutomationRunsBucket[];
	triggers: { trigger: AutomationRunTriggerKey; count: number }[];
	automations: AutomationMonitoringRow[];
	recentFailures: AutomationRunFailure[];
}

export interface AutomationsKpis {
	runs: PeriodValue<number>;
	failedRuns: PeriodValue<number>;
	/** Completed runs over finished ones (completed or failed); null without any finished run. */
	successRate: PeriodValue<number | null>;
	durationP50Ms: number | null;
	durationP95Ms: number | null;
	activeAutomations: number;
	totalAutomations: number;
}

/** UTC hour buckets (`YYYY-MM-DDTHH`) for the 24h range, UTC day buckets (`YYYY-MM-DD`) otherwise. */
export type AutomationRunsBucket = { bucket: string } & Record<AutomationRunStatus, number>;

export interface AutomationMonitoringRow {
	id: string;
	title: string;
	owner: { id: string; name: string } | null;
	isActive: boolean;
	runs: number;
	failedRuns: number;
	failureRate: number;
	durationP50Ms: number | null;
	lastRun: { status: AutomationRunStatus; startedAt: Date } | null;
}

export interface AutomationRunFailure {
	runId: string;
	automationId: string;
	automationTitle: string;
	trigger: AutomationRunTriggerKey;
	startedAt: Date;
	errorMessage: string | null;
	chatId: string | null;
}

export type { AutomationRunStatus, AutomationRunTrigger } from './automation';
