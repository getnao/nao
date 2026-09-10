import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';

import s, {
	type DBScheduledJob,
	type DBWebRobot,
	type DBWebRobotRun,
	type NewWebRobot,
	type NewWebRobotRun,
} from '../db/abstractSchema';
import { db } from '../db/db';
import { WEB_ROBOT_ACTIVE_RUN_STATUSES, type WebRobotRunStatus } from '../types/web-robot';

export type WebRobotWithSchedule = DBWebRobot & {
	cron: string | null;
	enabled: boolean;
	scheduledJob: DBScheduledJob | null;
};

export type WebRobotListItem = WebRobotWithSchedule & {
	lastRunStatus: DBWebRobotRun['status'] | null;
	lastRunStartedAt: Date | null;
};

const WEB_ROBOT_RUN_STALE_MS = 6 * 60 * 60_000;
const WEB_ROBOT_RUN_STALE_MESSAGE = 'Web robot run did not finish before the stale-run timeout.';

export const failStaleWebRobotRuns = async (): Promise<number> => {
	const cutoff = new Date(Date.now() - WEB_ROBOT_RUN_STALE_MS);
	const rows = await db
		.update(s.webRobotRun)
		.set({ status: 'failed', errorMessage: WEB_ROBOT_RUN_STALE_MESSAGE, completedAt: new Date() })
		.where(
			or(
				and(eq(s.webRobotRun.status, 'running'), lt(s.webRobotRun.startedAt, cutoff)),
				and(eq(s.webRobotRun.status, 'queued'), lt(s.webRobotRun.queuedAt, cutoff)),
			),
		)
		.returning({ id: s.webRobotRun.id })
		.execute();
	return rows.length;
};

export const listWebRobots = async (projectId: string): Promise<WebRobotListItem[]> => {
	await failStaleWebRobotRuns();
	const rows = await db
		.select({ robot: s.webRobot, scheduledJob: s.scheduledJob })
		.from(s.webRobot)
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.webRobot.scheduledJobId))
		.where(and(eq(s.webRobot.projectId, projectId), isNull(s.webRobot.archivedAt)))
		.orderBy(desc(s.webRobot.updatedAt))
		.execute();

	return Promise.all(
		rows.map(async ({ robot, scheduledJob }) => ({
			...mapRobotWithSchedule(robot, scheduledJob),
			...(await latestRunSummary(robot.id)),
		})),
	);
};

export const listPublishedWebDatasets = async (projectId: string): Promise<DBWebRobot[]> => {
	return db
		.select()
		.from(s.webRobot)
		.where(
			and(
				eq(s.webRobot.projectId, projectId),
				isNull(s.webRobot.archivedAt),
				isNotNull(s.webRobot.lastSuccessfulRunId),
			),
		)
		.orderBy(s.webRobot.name)
		.execute();
};

export const getWebRobot = async (projectId: string, id: string): Promise<WebRobotWithSchedule | null> => {
	const [row] = await db
		.select({ robot: s.webRobot, scheduledJob: s.scheduledJob })
		.from(s.webRobot)
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.webRobot.scheduledJobId))
		.where(and(eq(s.webRobot.id, id), eq(s.webRobot.projectId, projectId), isNull(s.webRobot.archivedAt)))
		.execute();
	return row ? mapRobotWithSchedule(row.robot, row.scheduledJob) : null;
};

export const getWebRobotById = async (id: string): Promise<WebRobotWithSchedule | null> => {
	const [row] = await db
		.select({ robot: s.webRobot, scheduledJob: s.scheduledJob })
		.from(s.webRobot)
		.leftJoin(s.scheduledJob, eq(s.scheduledJob.id, s.webRobot.scheduledJobId))
		.where(and(eq(s.webRobot.id, id), isNull(s.webRobot.archivedAt)))
		.execute();
	return row ? mapRobotWithSchedule(row.robot, row.scheduledJob) : null;
};

export const createWebRobot = async (data: NewWebRobot): Promise<DBWebRobot> => {
	const [created] = await db.insert(s.webRobot).values(data).returning().execute();
	return created;
};

export const updateWebRobot = async (
	projectId: string,
	id: string,
	data: Partial<
		Pick<
			NewWebRobot,
			'name' | 'description' | 'definition' | 'definitionVersion' | 'definitionHash' | 'scheduledJobId'
		>
	>,
): Promise<DBWebRobot | null> => {
	const [updated] = await db
		.update(s.webRobot)
		.set(data)
		.where(and(eq(s.webRobot.id, id), eq(s.webRobot.projectId, projectId), isNull(s.webRobot.archivedAt)))
		.returning()
		.execute();
	return updated ?? null;
};

export const archiveWebRobot = async (projectId: string, id: string): Promise<DBWebRobot | null> => {
	const [archived] = await db
		.update(s.webRobot)
		.set({ archivedAt: new Date() })
		.where(and(eq(s.webRobot.id, id), eq(s.webRobot.projectId, projectId), isNull(s.webRobot.archivedAt)))
		.returning()
		.execute();
	return archived ?? null;
};

export const markWebRobotPublish = async (
	id: string,
	runId: string,
	productCount: number,
	completedAt: Date,
): Promise<void> => {
	await db
		.update(s.webRobot)
		.set({ lastSuccessfulRunId: runId, lastSuccessfulRunAt: completedAt, lastPublishedProductCount: productCount })
		.where(eq(s.webRobot.id, id))
		.execute();
};

export const createWebRobotRun = async (data: NewWebRobotRun): Promise<DBWebRobotRun> => {
	const [created] = await db.insert(s.webRobotRun).values(data).returning().execute();
	return created;
};

export const getWebRobotRun = async (projectId: string, id: string): Promise<DBWebRobotRun | null> => {
	await failStaleWebRobotRuns();
	const [row] = await db
		.select({ run: s.webRobotRun })
		.from(s.webRobotRun)
		.innerJoin(s.webRobot, eq(s.webRobot.id, s.webRobotRun.robotId))
		.where(and(eq(s.webRobotRun.id, id), eq(s.webRobot.projectId, projectId)))
		.execute();
	return row?.run ?? null;
};

export const getWebRobotRunById = async (id: string): Promise<DBWebRobotRun | null> => {
	const [run] = await db.select().from(s.webRobotRun).where(eq(s.webRobotRun.id, id)).execute();
	return run ?? null;
};

export const listWebRobotRuns = async (projectId: string, robotId: string, limit = 20): Promise<DBWebRobotRun[]> => {
	await failStaleWebRobotRuns();
	const rows = await db
		.select({ run: s.webRobotRun })
		.from(s.webRobotRun)
		.innerJoin(s.webRobot, eq(s.webRobot.id, s.webRobotRun.robotId))
		.where(and(eq(s.webRobotRun.robotId, robotId), eq(s.webRobot.projectId, projectId)))
		.orderBy(desc(s.webRobotRun.queuedAt))
		.limit(limit)
		.execute();
	return rows.map((row) => row.run);
};

export const findActiveWebRobotRun = async (robotId: string): Promise<DBWebRobotRun | null> => {
	return (await listActiveWebRobotRuns(robotId, 1))[0] ?? null;
};

export const listActiveWebRobotRuns = async (robotId: string, limit = 20): Promise<DBWebRobotRun[]> => {
	return db
		.select()
		.from(s.webRobotRun)
		.where(and(eq(s.webRobotRun.robotId, robotId), inArray(s.webRobotRun.status, WEB_ROBOT_ACTIVE_RUN_STATUSES)))
		.orderBy(desc(s.webRobotRun.queuedAt))
		.limit(limit)
		.execute();
};

export const setWebRobotRunScheduledJob = async (id: string, scheduledJobId: string | null): Promise<void> => {
	await db.update(s.webRobotRun).set({ scheduledJobId }).where(eq(s.webRobotRun.id, id)).execute();
};

export const markWebRobotRunRunning = async (id: string): Promise<DBWebRobotRun | null> => {
	const [run] = await db
		.update(s.webRobotRun)
		.set({ status: 'running', startedAt: new Date() })
		.where(and(eq(s.webRobotRun.id, id), eq(s.webRobotRun.status, 'queued')))
		.returning()
		.execute();
	return run ?? null;
};

export const completeWebRobotRun = async (
	id: string,
	status: Extract<WebRobotRunStatus, 'completed' | 'partial' | 'failed' | 'cancelled'>,
	stats: NewWebRobotRun['stats'],
	errorMessage: string | null,
	artifactPrefix?: string | null,
): Promise<void> => {
	await db
		.update(s.webRobotRun)
		.set({ status, stats, errorMessage, artifactPrefix, completedAt: new Date() })
		.where(eq(s.webRobotRun.id, id))
		.execute();
};

export const requestWebRobotRunCancel = async (id: string): Promise<void> => {
	await db
		.update(s.webRobotRun)
		.set({ cancelRequestedAt: new Date() })
		.where(and(eq(s.webRobotRun.id, id), inArray(s.webRobotRun.status, WEB_ROBOT_ACTIVE_RUN_STATUSES)))
		.execute();
};

export const cancelQueuedWebRobotRun = async (id: string): Promise<void> => {
	await db
		.update(s.webRobotRun)
		.set({ status: 'cancelled', completedAt: new Date(), errorMessage: 'Cancelled before the run started.' })
		.where(and(eq(s.webRobotRun.id, id), eq(s.webRobotRun.status, 'queued')))
		.execute();
};

const latestRunSummary = async (
	robotId: string,
): Promise<Pick<WebRobotListItem, 'lastRunStatus' | 'lastRunStartedAt'>> => {
	const [run] = await db
		.select({ status: s.webRobotRun.status, startedAt: s.webRobotRun.startedAt, queuedAt: s.webRobotRun.queuedAt })
		.from(s.webRobotRun)
		.where(eq(s.webRobotRun.robotId, robotId))
		.orderBy(desc(s.webRobotRun.queuedAt))
		.limit(1)
		.execute();
	return { lastRunStatus: run?.status ?? null, lastRunStartedAt: run?.startedAt ?? run?.queuedAt ?? null };
};

const mapRobotWithSchedule = (robot: DBWebRobot, scheduledJob: DBScheduledJob | null): WebRobotWithSchedule => ({
	...robot,
	cron: scheduledJob?.cron ?? null,
	enabled: scheduledJob?.status === 'pending',
	scheduledJob,
});
