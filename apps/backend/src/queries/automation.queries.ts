import { displayChart, executeSql } from '@nao/shared/tools';
import { and, asc, count, desc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';

import s, {
	type DBAutomation,
	type DBAutomationRun,
	type DBMessagePart,
	type DBScheduledJob,
	type NewAutomation,
	type NewAutomationRun,
} from '../db/abstractSchema';
import { db } from '../db/db';
import type { AutomationIntegrationResult } from '../types/automation';

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

export const linkAutomationJob = async (id: string, scheduledJobId: string | null): Promise<void> => {
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
			| 'webhookEnabled'
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

export type AutomationRunHistoryEntry = {
	id: string;
	status: DBAutomationRun['status'];
	startedAt: Date;
	completedAt: Date | null;
	errorMessage: string | null;
	summary: string | null;
	integrationResults: AutomationIntegrationResult[];
};

export const getAutomationRunHistory = async (
	automationId: string,
	options?: { limit?: number; excludeRunId?: string },
): Promise<AutomationRunHistoryEntry[]> => {
	const conditions = [eq(s.automationRun.automationId, automationId)];
	if (options?.excludeRunId) {
		conditions.push(ne(s.automationRun.id, options.excludeRunId));
	}
	const runs = await db
		.select()
		.from(s.automationRun)
		.where(and(...conditions))
		.orderBy(desc(s.automationRun.startedAt))
		.limit(options?.limit ?? 10)
		.execute();

	const outputs = await loadAutomationRunOutputs(runs);
	return runs.map((run) => ({
		id: run.id,
		status: run.status,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
		errorMessage: run.errorMessage,
		summary: outputs.get(run.id)?.text ?? null,
		integrationResults: run.integrationResults,
	}));
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

export const markAutomationRunRead = async (projectId: string, userId: string, runId: string): Promise<boolean> => {
	const run = await getAutomationRunForUser(projectId, userId, runId);
	if (!run) {
		return false;
	}
	if (run.readAt) {
		return true;
	}
	await db.update(s.automationRun).set({ readAt: new Date() }).where(eq(s.automationRun.id, runId)).execute();
	return true;
};

export const countUnreadAutomationRuns = async (projectId: string, userId: string): Promise<number> => {
	const [row] = await db
		.select({ value: count() })
		.from(s.automationRun)
		.innerJoin(s.automation, eq(s.automation.id, s.automationRun.automationId))
		.where(
			and(eq(s.automation.projectId, projectId), eq(s.automation.userId, userId), isNull(s.automationRun.readAt)),
		)
		.execute();
	return row?.value ?? 0;
};

export const markAllAutomationRunsRead = async (projectId: string, userId: string): Promise<void> => {
	const automationIds = db
		.select({ id: s.automation.id })
		.from(s.automation)
		.where(and(eq(s.automation.projectId, projectId), eq(s.automation.userId, userId)));
	await db
		.update(s.automationRun)
		.set({ readAt: new Date() })
		.where(and(inArray(s.automationRun.automationId, automationIds), isNull(s.automationRun.readAt)))
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
	config: displayChart.ChartInput;
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
		| 'readAt'
	>;
	automation: Pick<DBAutomation, 'id' | 'title' | 'scheduleDescription'> & { cron: string };
	output: AutomationFeedOutput;
};

export type AutomationFeedItem = AutomationFeedAutomationItem;

export const listAutomationFeedRuns = async (
	projectId: string,
	userId: string,
	limit: number,
): Promise<AutomationFeedItem[]> => {
	const automationItems = await listAutomationRunFeedItems(projectId, userId, limit);
	automationItems.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
	return automationItems.slice(0, limit);
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
			readAt: run.readAt,
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
	const config = displayChart.ChartInputSchema.safeParse(part.toolInput);
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
