import { displayChart, executeSql } from '@nao/shared/tools';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';

import s, {
	type ActivityTrigger,
	type ChatVisibility,
	type DBActivity,
	type DBAutomation,
	type DBAutomationRun,
	type DBMessagePart,
	type DBScheduledJob,
	type NewAutomation,
	type NewAutomationRun,
	type StoryVisibility,
} from '../db/abstractSchema';
import { db } from '../db/db';
import type { AutomationIntegrationResult } from '../types/automation';
import { type ListActivityRow, listRecentActivities } from './activity.queries';

export const automationJobUniqueKey = (automationId: string): string => `automation:${automationId}`;
const AUTOMATION_RUN_STALE_MS = 30 * 60 * 1_000;
const AUTOMATION_RUN_STALE_MESSAGE = 'Automation run did not finish before the timeout.';
const AUTOMATION_RUN_CANCELLED_MESSAGE = 'Cancelled by user.';

export type AutomationWithSchedule = DBAutomation & {
	cron: string;
	enabled: boolean;
	scheduledJob: DBScheduledJob | null;
};

export type AutomationListItem = AutomationWithSchedule & {
	lastRunStatus: DBAutomationRun['status'] | null;
	lastRunStartedAt: Date | null;
};

export const listAutomations = async (projectId: string, userId: string): Promise<AutomationListItem[]> => {
	await failStaleAutomationRuns();
	const rows = await db
		.select({ automation: s.automation, scheduledJob: s.scheduledJob })
		.from(s.automation)
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.automation.scheduledJobId))
		.where(and(eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)))
		.orderBy(desc(s.automation.updatedAt))
		.execute();

	return Promise.all(
		rows.map(async ({ automation, scheduledJob }) => ({
			...mapAutomationWithSchedule(automation, scheduledJob),
			...(await getLatestRunSummary(automation.id)),
		})),
	);
};

async function getLatestRunSummary(
	automationId: string,
): Promise<Pick<AutomationListItem, 'lastRunStatus' | 'lastRunStartedAt'>> {
	const [run] = await db
		.select({
			status: s.automationRun.status,
			startedAt: s.automationRun.startedAt,
		})
		.from(s.automationRun)
		.where(eq(s.automationRun.automationId, automationId))
		.orderBy(desc(s.automationRun.startedAt))
		.limit(1)
		.execute();

	return {
		lastRunStatus: run?.status ?? null,
		lastRunStartedAt: run?.startedAt ?? null,
	};
}

export const getAutomation = async (
	projectId: string,
	userId: string,
	id: string,
): Promise<AutomationWithSchedule | null> => {
	const [row] = await db
		.select({ automation: s.automation, scheduledJob: s.scheduledJob })
		.from(s.automation)
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.automation.scheduledJobId))
		.where(and(eq(s.automation.id, id), eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)))
		.execute();
	return row ? mapAutomationWithSchedule(row.automation, row.scheduledJob) : null;
};

export const getAutomationById = async (id: string): Promise<AutomationWithSchedule | null> => {
	const [row] = await db
		.select({ automation: s.automation, scheduledJob: s.scheduledJob })
		.from(s.automation)
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.automation.scheduledJobId))
		.where(eq(s.automation.id, id))
		.execute();
	return row ? mapAutomationWithSchedule(row.automation, row.scheduledJob) : null;
};

export const createAutomation = async (data: NewAutomation): Promise<DBAutomation> => {
	const [created] = await db.insert(s.automation).values(data).returning().execute();
	return created;
};

export const linkAutomationJob = async (id: string, scheduledJobId: string): Promise<void> => {
	await db.update(s.automation).set({ scheduledJobId }).where(eq(s.automation.id, id)).execute();
};

export const updateAutomation = async (
	projectId: string,
	userId: string,
	id: string,
	data: Partial<
		Pick<
			NewAutomation,
			| 'title'
			| 'prompt'
			| 'scheduleDescription'
			| 'timezone'
			| 'modelProvider'
			| 'modelId'
			| 'mcpEnabled'
			| 'mcpServers'
			| 'integrations'
		>
	>,
): Promise<DBAutomation | null> => {
	const [updated] = await db
		.update(s.automation)
		.set(data)
		.where(and(eq(s.automation.id, id), eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)))
		.returning()
		.execute();
	return updated ?? null;
};

export const deleteAutomation = async (projectId: string, userId: string, id: string): Promise<void> => {
	await db.transaction(async (tx) => {
		const runChats = await tx
			.select({ chatId: s.automationRun.chatId })
			.from(s.automationRun)
			.innerJoin(s.automation, eq(s.automation.id, s.automationRun.automationId))
			.where(and(eq(s.automation.id, id), eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)))
			.execute();

		for (const { chatId } of runChats) {
			if (chatId) {
				await tx.delete(s.chat).where(eq(s.chat.id, chatId)).execute();
			}
		}

		await tx
			.delete(s.automation)
			.where(and(eq(s.automation.id, id), eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)))
			.execute();
	});
};

export const listAutomationRuns = async (
	projectId: string,
	userId: string,
	automationId: string,
): Promise<DBAutomationRun[]> => {
	await failStaleAutomationRuns();
	const rows = await db
		.select({ run: s.automationRun })
		.from(s.automationRun)
		.innerJoin(s.automation, eq(s.automation.id, s.automationRun.automationId))
		.where(
			and(
				eq(s.automation.id, automationId),
				eq(s.automation.projectId, projectId),
				eq(s.automation.userId, userId),
			),
		)
		.orderBy(desc(s.automationRun.startedAt))
		.execute();
	return rows.map((row) => row.run);
};

export const getAutomationRunByChatId = async (
	chatId: string,
): Promise<Pick<
	DBAutomationRun,
	'id' | 'automationId' | 'status' | 'startedAt' | 'completedAt' | 'errorMessage'
> | null> => {
	await failStaleAutomationRuns();
	const [run] = await db
		.select({
			id: s.automationRun.id,
			automationId: s.automationRun.automationId,
			status: s.automationRun.status,
			startedAt: s.automationRun.startedAt,
			completedAt: s.automationRun.completedAt,
			errorMessage: s.automationRun.errorMessage,
		})
		.from(s.automationRun)
		.where(eq(s.automationRun.chatId, chatId))
		.limit(1)
		.execute();
	return run ?? null;
};

export const createAutomationRun = async (data: NewAutomationRun): Promise<DBAutomationRun> => {
	const [created] = await db.insert(s.automationRun).values(data).returning().execute();
	return created;
};

export const attachRunChat = async (runId: string, chatId: string): Promise<void> => {
	await db.update(s.automationRun).set({ chatId }).where(eq(s.automationRun.id, runId)).execute();
};

export const completeAutomationRun = async (
	runId: string,
	integrationResults: AutomationIntegrationResult[],
): Promise<void> => {
	await db
		.update(s.automationRun)
		.set({ status: 'completed', completedAt: new Date(), integrationResults })
		.where(and(eq(s.automationRun.id, runId), eq(s.automationRun.status, 'running')))
		.execute();
};

export const failAutomationRun = async (runId: string, errorMessage: string): Promise<void> => {
	await db
		.update(s.automationRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage })
		.where(and(eq(s.automationRun.id, runId), eq(s.automationRun.status, 'running')))
		.execute();
};

export const getAutomationRunForUser = async (
	projectId: string,
	userId: string,
	runId: string,
): Promise<DBAutomationRun | null> => {
	const [row] = await db
		.select({ run: s.automationRun })
		.from(s.automationRun)
		.innerJoin(s.automation, eq(s.automation.id, s.automationRun.automationId))
		.where(
			and(eq(s.automationRun.id, runId), eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)),
		)
		.execute();
	return row?.run ?? null;
};

/**
 * Flips a running automation run to `cancelled`. Guarded by `status = 'running'`
 * so it's idempotent and safely no-ops on already-terminal runs (including
 * those completed concurrently by the agent loop).
 */
export const cancelAutomationRun = async (runId: string): Promise<boolean> => {
	const rows = await db
		.update(s.automationRun)
		.set({ status: 'cancelled', completedAt: new Date(), errorMessage: AUTOMATION_RUN_CANCELLED_MESSAGE })
		.where(and(eq(s.automationRun.id, runId), eq(s.automationRun.status, 'running')))
		.returning({ id: s.automationRun.id })
		.execute();
	return rows.length > 0;
};

export const failStaleAutomationRuns = async (): Promise<number> => {
	const cutoff = new Date(Date.now() - AUTOMATION_RUN_STALE_MS);
	const rows = await db
		.update(s.automationRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage: AUTOMATION_RUN_STALE_MESSAGE })
		.where(and(eq(s.automationRun.status, 'running'), lte(s.automationRun.startedAt, cutoff)))
		.returning({ id: s.automationRun.id })
		.execute();
	return rows.length;
};

function mapAutomationWithSchedule(
	automation: DBAutomation,
	scheduledJob: DBScheduledJob | null,
): AutomationWithSchedule {
	return {
		...automation,
		cron: scheduledJob?.cron ?? '',
		enabled: scheduledJob ? scheduledJob.status !== 'paused' : false,
		scheduledJob,
	};
}

export type AutomationFeedChart = {
	toolCallId: string;
	config: displayChart.Input;
	data: unknown[];
};

export type AutomationFeedOutput = {
	text: string | null;
	charts: AutomationFeedChart[];
};

export type AutomationFeedAutomationItem = {
	kind: 'automation';
	id: string;
	startedAt: Date;
	run: Pick<
		DBAutomationRun,
		| 'id'
		| 'automationId'
		| 'status'
		| 'startedAt'
		| 'completedAt'
		| 'errorMessage'
		| 'chatId'
		| 'integrationResults'
	>;
	automation: Pick<DBAutomation, 'id' | 'title' | 'scheduleDescription'> & { cron: string };
	output: AutomationFeedOutput;
};

type BaseActivityFields = {
	id: string;
	status: DBActivity['status'];
	trigger: ActivityTrigger;
	startedAt: Date;
	completedAt: Date | null;
	errorMessage: string | null;
};

export type ActivityFeedStoryRefreshItem = {
	kind: 'activity';
	id: string;
	startedAt: Date;
	activity: BaseActivityFields & {
		type: 'story.refreshed';
		queriesRefreshed: number;
	};
	story: {
		id: string;
		slug: string;
		title: string;
		chatId: string | null;
		cacheSchedule: string | null;
		cacheScheduleDescription: string | null;
	};
};

export type ActivityFeedStorySharedItem = {
	kind: 'activity';
	id: string;
	startedAt: Date;
	activity: BaseActivityFields & {
		type: 'story.shared';
	};
	story: {
		id: string;
		slug: string;
		title: string;
		chatId: string | null;
	};
	share: {
		id: string;
		visibility: StoryVisibility;
	};
	actorName: string | null;
};

export type ActivityFeedChatSharedItem = {
	kind: 'activity';
	id: string;
	startedAt: Date;
	activity: BaseActivityFields & {
		type: 'chat.shared';
	};
	chat: {
		id: string;
		title: string;
	};
	share: {
		id: string;
		visibility: ChatVisibility;
	};
	actorName: string | null;
};

export type ActivityFeedItem = ActivityFeedStoryRefreshItem | ActivityFeedStorySharedItem | ActivityFeedChatSharedItem;

export type AutomationFeedItem = AutomationFeedAutomationItem | ActivityFeedItem;

export const listAutomationFeedRuns = async (
	projectId: string,
	userId: string,
	limit: number,
): Promise<AutomationFeedItem[]> => {
	const [automationItems, activityItems] = await Promise.all([
		listAutomationRunFeedItems(projectId, userId, limit),
		listActivityFeedItems(projectId, userId, limit),
	]);

	const merged: AutomationFeedItem[] = [...automationItems, ...activityItems];
	merged.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
	return merged.slice(0, limit);
};

async function listAutomationRunFeedItems(
	projectId: string,
	userId: string,
	limit: number,
): Promise<AutomationFeedAutomationItem[]> {
	await failStaleAutomationRuns();
	const rows = await db
		.select({
			run: s.automationRun,
			automation: s.automation,
			scheduledJob: s.scheduledJob,
		})
		.from(s.automationRun)
		.innerJoin(s.automation, eq(s.automation.id, s.automationRun.automationId))
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.automation.scheduledJobId))
		.where(and(eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)))
		.orderBy(desc(s.automationRun.startedAt))
		.limit(limit)
		.execute();

	const outputsByRunId = await loadAutomationRunOutputs(rows.map(({ run }) => run));
	return rows.map(({ run, automation, scheduledJob }) =>
		buildAutomationFeedItem(
			run,
			automation,
			scheduledJob,
			outputsByRunId.get(run.id) ?? { text: null, charts: [] },
		),
	);
}

async function listActivityFeedItems(projectId: string, userId: string, limit: number): Promise<ActivityFeedItem[]> {
	const rows = await listRecentActivities(projectId, userId, limit, [
		'story.refreshed',
		'story.shared',
		'chat.shared',
	]);
	return rows.map((row) => buildActivityFeedItem(row)).filter((item): item is ActivityFeedItem => item !== null);
}

function buildActivityFeedItem(row: ListActivityRow): ActivityFeedItem | null {
	const base = {
		id: row.activity.id,
		status: row.activity.status,
		trigger: row.activity.trigger,
		startedAt: row.activity.startedAt,
		completedAt: row.activity.completedAt,
		errorMessage: row.activity.errorMessage,
	};
	if (row.activity.type === 'story.refreshed') {
		if (!row.story) {
			return null;
		}
		return {
			kind: 'activity',
			id: row.activity.id,
			startedAt: row.activity.startedAt,
			activity: {
				...base,
				type: 'story.refreshed',
				queriesRefreshed: readNumber(row.activity.payload, 'queriesRefreshed') ?? 0,
			},
			story: row.story,
		};
	}
	if (row.activity.type === 'story.shared') {
		if (!row.story || !row.storyShare) {
			return null;
		}
		return {
			kind: 'activity',
			id: row.activity.id,
			startedAt: row.activity.startedAt,
			activity: { ...base, type: 'story.shared' },
			story: {
				id: row.story.id,
				slug: row.story.slug,
				title: row.story.title,
				chatId: row.story.chatId,
			},
			share: row.storyShare,
			actorName: row.actorName,
		};
	}
	if (row.activity.type === 'chat.shared') {
		if (!row.chat || !row.chatShare) {
			return null;
		}
		return {
			kind: 'activity',
			id: row.activity.id,
			startedAt: row.activity.startedAt,
			activity: { ...base, type: 'chat.shared' },
			chat: row.chat,
			share: row.chatShare,
			actorName: row.actorName,
		};
	}
	return null;
}

function readNumber(payload: Record<string, unknown> | null, key: string): number | null {
	if (!payload) {
		return null;
	}
	const value = payload[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildAutomationFeedItem(
	run: DBAutomationRun,
	automation: DBAutomation,
	scheduledJob: DBScheduledJob | null,
	output: AutomationFeedOutput,
): AutomationFeedAutomationItem {
	return {
		kind: 'automation',
		id: run.id,
		startedAt: run.startedAt,
		run: {
			id: run.id,
			automationId: run.automationId,
			status: run.status,
			startedAt: run.startedAt,
			completedAt: run.completedAt,
			errorMessage: run.errorMessage,
			chatId: run.chatId,
			integrationResults: run.integrationResults,
		},
		automation: {
			id: automation.id,
			title: automation.title,
			scheduleDescription: automation.scheduleDescription,
			cron: scheduledJob?.cron ?? '',
		},
		output,
	};
}

/**
 * Resolves each run's output in two batched queries (one for the run's
 * assistant message, one for that message's parts) so the feed avoids the
 * `1 + 2*N` query pattern. The run's output is the *earliest* assistant
 * message in its chat, not the latest — automations create a fresh chat per
 * run, but users can later send follow-ups in that chat, so anchoring on the
 * first assistant message keeps historical runs showing their own reply.
 */
async function loadAutomationRunOutputs(runs: DBAutomationRun[]): Promise<Map<string, AutomationFeedOutput>> {
	const outputs = new Map<string, AutomationFeedOutput>();
	const chatIds = [...new Set(runs.map((run) => run.chatId).filter((id): id is string => id !== null))];
	if (chatIds.length === 0) {
		return outputs;
	}

	const messages = await db
		.select({ id: s.chatMessage.id, chatId: s.chatMessage.chatId, createdAt: s.chatMessage.createdAt })
		.from(s.chatMessage)
		.where(
			and(
				inArray(s.chatMessage.chatId, chatIds),
				eq(s.chatMessage.role, 'assistant'),
				isNull(s.chatMessage.supersededAt),
			),
		)
		.orderBy(asc(s.chatMessage.createdAt))
		.execute();

	const firstAssistantByChat = new Map<string, string>();
	for (const message of messages) {
		if (!firstAssistantByChat.has(message.chatId)) {
			firstAssistantByChat.set(message.chatId, message.id);
		}
	}

	const messageIds = [...firstAssistantByChat.values()];
	if (messageIds.length === 0) {
		return outputs;
	}

	const parts = await db
		.select()
		.from(s.messagePart)
		.where(inArray(s.messagePart.messageId, messageIds))
		.orderBy(asc(s.messagePart.order))
		.execute();

	const partsByMessageId = new Map<string, DBMessagePart[]>();
	for (const part of parts) {
		const list = partsByMessageId.get(part.messageId) ?? [];
		list.push(part);
		partsByMessageId.set(part.messageId, list);
	}

	for (const run of runs) {
		if (!run.chatId) {
			continue;
		}
		const messageId = firstAssistantByChat.get(run.chatId);
		if (!messageId) {
			continue;
		}
		outputs.set(run.id, extractAutomationFeedOutput(partsByMessageId.get(messageId) ?? []));
	}

	return outputs;
}

function extractAutomationFeedOutput(parts: DBMessagePart[]): AutomationFeedOutput {
	const text = parts
		.filter((part) => part.type === 'text' && part.text)
		.map((part) => part.text as string)
		.join('\n\n')
		.trim();

	const charts = collectChartsFromParts(parts);

	return { text: text.length > 0 ? text : null, charts };
}

function collectChartsFromParts(parts: DBMessagePart[]): AutomationFeedChart[] {
	const sqlOutputsByQueryId = indexSqlOutputsByQueryId(parts);
	const charts: AutomationFeedChart[] = [];

	for (const part of parts) {
		const chart = parseChartPart(part, sqlOutputsByQueryId);
		if (chart) {
			charts.push(chart);
		}
	}

	return charts;
}

function indexSqlOutputsByQueryId(parts: DBMessagePart[]): Map<string, executeSql.Output> {
	const outputs = new Map<string, executeSql.Output>();
	for (const part of parts) {
		if (part.type !== 'tool-execute_sql' || part.toolState !== 'output-available' || !part.toolOutput) {
			continue;
		}
		const parsed = executeSql.OutputSchema.safeParse(part.toolOutput);
		if (parsed.success) {
			outputs.set(parsed.data.id, parsed.data);
		}
	}
	return outputs;
}

function parseChartPart(
	part: DBMessagePart,
	sqlOutputsByQueryId: Map<string, executeSql.Output>,
): AutomationFeedChart | null {
	if (part.type !== 'tool-display_chart' || part.toolState !== 'output-available' || !part.toolCallId) {
		return null;
	}
	const config = displayChart.InputSchema.safeParse(part.toolInput);
	if (!config.success) {
		return null;
	}
	const sqlOutput = sqlOutputsByQueryId.get(config.data.query_id);
	if (!sqlOutput || sqlOutput.data.length === 0) {
		return null;
	}
	return {
		toolCallId: part.toolCallId,
		config: config.data,
		data: sqlOutput.data,
	};
}
