import { and, desc, eq, lte } from 'drizzle-orm';

import s, {
	type DBAutomation,
	type DBAutomationRun,
	type DBScheduledJob,
	type NewAutomation,
	type NewAutomationRun,
} from '../db/abstractSchema';
import { db } from '../db/db';
import type { AutomationIntegrationResult } from '../types/automation';

export const automationJobUniqueKey = (automationId: string): string => `automation:${automationId}`;
const AUTOMATION_RUN_STALE_MS = 30 * 60 * 1_000;
const AUTOMATION_RUN_STALE_MESSAGE = 'Automation run did not finish before the timeout.';

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
