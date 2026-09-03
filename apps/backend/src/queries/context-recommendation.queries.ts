import { readFile } from '@nao/shared/tools';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';

import s, {
	DBContextRecommendation,
	DBContextRecommendationConfig,
	DBContextRecommendationRun,
	NewContextRecommendation,
	NewContextRecommendationConfig,
} from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import {
	ContextFileReadCost,
	ContextRecommendationStatus,
	RecommendationInsight,
	WindowTotals,
} from '../types/context-recommendation';

export interface FeedbackLink {
	recommendationId: string;
	messageId: string;
	chatId: string;
	vote: 'up' | 'down';
	explanation: string | null;
	userName: string;
}

export interface UnlinkedFeedback {
	messageId: string;
	chatId: string;
	explanation: string | null;
	createdAt: Date;
	userName: string;
}

export interface MessageRecommendationLink {
	messageId: string;
	recommendationId: string;
	title: string;
	status: ContextRecommendationStatus;
}

const CONTEXT_RECOMMENDATION_RUN_STALE_MS = 10 * 60 * 1_000;
const CONTEXT_RECOMMENDATION_RUN_STALE_MESSAGE = 'Context recommendations run did not finish before the timeout.';
const CONTEXT_RECOMMENDATION_RUN_CANCELLED_MESSAGE = 'Cancelled by user.';

/**
 * Statuses the reconciler must see, i.e. everything except `dismissed` (handled
 * separately as fingerprints). `applied` rows must be included so a re-recorded
 * fingerprint reopens the row instead of inserting a duplicate.
 */
const RECONCILABLE_STATUSES = ['open', 'applied'] as const;

type ContextRecommendationConfigPatch = Partial<
	Omit<NewContextRecommendationConfig, 'projectId' | 'createdAt' | 'updatedAt'>
>;

export async function getConfig(projectId: string): Promise<DBContextRecommendationConfig | null> {
	const [config] = await db
		.select()
		.from(s.contextRecommendationConfig)
		.where(eq(s.contextRecommendationConfig.projectId, projectId))
		.limit(1)
		.execute();
	return config ?? null;
}

export async function listProjectRecommendationScheduleConfigs(): Promise<
	{ projectId: string; frequency: DBContextRecommendationConfig['frequency'] }[]
> {
	return db
		.select({
			projectId: s.project.id,
			frequency: s.contextRecommendationConfig.frequency,
		})
		.from(s.project)
		.leftJoin(s.contextRecommendationConfig, eq(s.contextRecommendationConfig.projectId, s.project.id))
		.where(isNotNull(s.project.path))
		.execute();
}

export async function updateConfig(
	projectId: string,
	patch: ContextRecommendationConfigPatch,
): Promise<DBContextRecommendationConfig> {
	const cleanedPatch = Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined),
	) as ContextRecommendationConfigPatch;

	const [config] = await db
		.insert(s.contextRecommendationConfig)
		.values({ projectId, ...cleanedPatch })
		.onConflictDoUpdate({
			target: s.contextRecommendationConfig.projectId,
			set: { ...cleanedPatch, updatedAt: new Date() },
		})
		.returning()
		.execute();
	return config;
}

export async function createRun(input: {
	projectId: string;
	trigger: 'schedule' | 'manual';
	windowStart?: Date;
	windowEnd?: Date;
	llmProvider?: DBContextRecommendationRun['llmProvider'];
	llmModelId?: string;
}): Promise<DBContextRecommendationRun> {
	const [run] = await db.insert(s.contextRecommendationRun).values(input).returning().execute();
	return run;
}

export async function setRunChat(runId: string, chatId: string, executor: DBExecutor = db): Promise<void> {
	await executor
		.update(s.contextRecommendationRun)
		.set({ chatId })
		.where(eq(s.contextRecommendationRun.id, runId))
		.execute();
}

export async function completeRun(
	runId: string,
	patch: {
		inputTotalTokens?: number;
		outputTotalTokens?: number;
		totalTokens?: number;
		llmProvider?: DBContextRecommendationRun['llmProvider'];
		llmModelId?: string;
	} = {},
	executor: DBExecutor = db,
): Promise<void> {
	await executor
		.update(s.contextRecommendationRun)
		.set({ status: 'completed', completedAt: new Date(), ...patch })
		.where(and(eq(s.contextRecommendationRun.id, runId), eq(s.contextRecommendationRun.status, 'running')))
		.execute();
}

export async function failRun(runId: string, errorMessage: string): Promise<void> {
	await db
		.update(s.contextRecommendationRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage })
		.where(and(eq(s.contextRecommendationRun.id, runId), eq(s.contextRecommendationRun.status, 'running')))
		.execute();
}

/**
 * Flips a running context recommendations run to `cancelled`. Guarded by
 * `status = 'running'` so it's idempotent and safely no-ops on already-terminal
 * runs (including those completed concurrently by the agent loop).
 */
export async function cancelRun(runId: string): Promise<boolean> {
	const rows = await db
		.update(s.contextRecommendationRun)
		.set({
			status: 'cancelled',
			completedAt: new Date(),
			errorMessage: CONTEXT_RECOMMENDATION_RUN_CANCELLED_MESSAGE,
		})
		.where(and(eq(s.contextRecommendationRun.id, runId), eq(s.contextRecommendationRun.status, 'running')))
		.returning({ id: s.contextRecommendationRun.id })
		.execute();
	return rows.length > 0;
}

export async function failStaleRuns(projectId: string): Promise<number> {
	const cutoff = new Date(Date.now() - CONTEXT_RECOMMENDATION_RUN_STALE_MS);
	const rows = await db
		.update(s.contextRecommendationRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage: CONTEXT_RECOMMENDATION_RUN_STALE_MESSAGE })
		.where(
			and(
				eq(s.contextRecommendationRun.projectId, projectId),
				eq(s.contextRecommendationRun.status, 'running'),
				lte(s.contextRecommendationRun.startedAt, cutoff),
			),
		)
		.returning({ id: s.contextRecommendationRun.id })
		.execute();
	return rows.length;
}

export async function getReconcilableRecommendations(projectId: string): Promise<DBContextRecommendation[]> {
	return db
		.select()
		.from(s.contextRecommendation)
		.where(
			and(
				eq(s.contextRecommendation.projectId, projectId),
				inArray(s.contextRecommendation.status, [...RECONCILABLE_STATUSES]),
			),
		)
		.execute();
}

export async function getDismissedFingerprints(projectId: string): Promise<string[]> {
	const rows = await db
		.select({ fingerprint: s.contextRecommendation.fingerprint })
		.from(s.contextRecommendation)
		.where(and(eq(s.contextRecommendation.projectId, projectId), eq(s.contextRecommendation.status, 'dismissed')))
		.execute();
	return rows.map((r) => r.fingerprint);
}

export async function insertRecommendation(
	value: NewContextRecommendation,
	executor: DBExecutor = db,
): Promise<DBContextRecommendation> {
	const [rec] = await executor.insert(s.contextRecommendation).values(value).returning().execute();
	return rec;
}

export async function updateRecommendation(
	id: string,
	patch: Partial<NewContextRecommendation>,
	executor: DBExecutor = db,
): Promise<void> {
	await executor
		.update(s.contextRecommendation)
		.set({ ...patch, lastSeenAt: new Date() })
		.where(eq(s.contextRecommendation.id, id))
		.execute();
}

export async function listRecommendations(
	projectId: string,
	status?: DBContextRecommendation['status'],
): Promise<DBContextRecommendation[]> {
	const where = status
		? and(eq(s.contextRecommendation.projectId, projectId), eq(s.contextRecommendation.status, status))
		: eq(s.contextRecommendation.projectId, projectId);
	return db
		.select()
		.from(s.contextRecommendation)
		.where(where)
		.orderBy(desc(s.contextRecommendation.impactScore))
		.execute();
}

export async function getRecommendationByFingerprint(
	projectId: string,
	fingerprint: string,
): Promise<DBContextRecommendation | null> {
	const [rec] = await db
		.select()
		.from(s.contextRecommendation)
		.where(
			and(eq(s.contextRecommendation.projectId, projectId), eq(s.contextRecommendation.fingerprint, fingerprint)),
		)
		.limit(1)
		.execute();
	return rec ?? null;
}

export async function getRecommendationById(projectId: string, id: string): Promise<DBContextRecommendation | null> {
	const [rec] = await db
		.select()
		.from(s.contextRecommendation)
		.where(and(eq(s.contextRecommendation.id, id), eq(s.contextRecommendation.projectId, projectId)))
		.limit(1)
		.execute();
	return rec ?? null;
}

export async function setRecommendationPr(
	id: string,
	pr: { prUrl: string; prBranch: string; prCreatedAt: Date },
): Promise<void> {
	await db
		.update(s.contextRecommendation)
		.set({ prUrl: pr.prUrl, prBranch: pr.prBranch, prCreatedAt: pr.prCreatedAt })
		.where(eq(s.contextRecommendation.id, id))
		.execute();
}

export async function getLatestRun(projectId: string): Promise<DBContextRecommendationRun | null> {
	await failStaleRuns(projectId);
	const [run] = await db
		.select()
		.from(s.contextRecommendationRun)
		.where(eq(s.contextRecommendationRun.projectId, projectId))
		.orderBy(desc(s.contextRecommendationRun.startedAt))
		.limit(1)
		.execute();
	return run ?? null;
}

export async function getLatestSuccessfulRun(projectId: string): Promise<DBContextRecommendationRun | null> {
	const [run] = await db
		.select()
		.from(s.contextRecommendationRun)
		.where(
			and(
				eq(s.contextRecommendationRun.projectId, projectId),
				eq(s.contextRecommendationRun.status, 'completed'),
			),
		)
		.orderBy(desc(s.contextRecommendationRun.completedAt))
		.limit(1)
		.execute();
	return run ?? null;
}

export async function getRunById(projectId: string, runId: string): Promise<DBContextRecommendationRun | null> {
	const [run] = await db
		.select()
		.from(s.contextRecommendationRun)
		.where(and(eq(s.contextRecommendationRun.id, runId), eq(s.contextRecommendationRun.projectId, projectId)))
		.limit(1)
		.execute();
	return run ?? null;
}

export async function setRecommendationStatus(input: {
	id: string;
	projectId: string;
	status: DBContextRecommendation['status'];
	userId: string;
}): Promise<void> {
	await db
		.update(s.contextRecommendation)
		.set({
			status: input.status,
			statusChangedAt: new Date(),
			statusChangedBy: input.userId,
		})
		.where(and(eq(s.contextRecommendation.id, input.id), eq(s.contextRecommendation.projectId, input.projectId)))
		.execute();
}

/** Total friction signals (errors, downvotes, regenerations) for a project over a window. */
export async function getWindowTotals(projectId: string, start: Date, end: Date): Promise<WindowTotals> {
	const analysisChatIds = () =>
		db
			.select({ id: s.contextRecommendationRun.chatId })
			.from(s.contextRecommendationRun)
			.where(
				and(eq(s.contextRecommendationRun.projectId, projectId), isNotNull(s.contextRecommendationRun.chatId)),
			);
	const [[errors], [downvotes], [regenerations]] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)` })
			.from(s.messagePart)
			.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(
				and(
					eq(s.chat.projectId, projectId),
					notInArray(s.chat.id, analysisChatIds()),
					eq(s.messagePart.toolState, 'output-error'),
					gte(s.messagePart.createdAt, start),
					lt(s.messagePart.createdAt, end),
				),
			)
			.execute(),
		db
			.select({ n: sql<number>`count(*)` })
			.from(s.messageFeedback)
			.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messageFeedback.messageId))
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(
				and(
					eq(s.chat.projectId, projectId),
					notInArray(s.chat.id, analysisChatIds()),
					eq(s.messageFeedback.vote, 'down'),
					gte(s.messageFeedback.createdAt, start),
					lt(s.messageFeedback.createdAt, end),
				),
			)
			.execute(),
		db
			.select({ n: sql<number>`count(*)` })
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(
				and(
					eq(s.chat.projectId, projectId),
					notInArray(s.chat.id, analysisChatIds()),
					isNotNull(s.chatMessage.supersededAt),
					gte(s.chatMessage.createdAt, start),
					lt(s.chatMessage.createdAt, end),
				),
			)
			.execute(),
	]);
	return {
		errors: Number(errors?.n ?? 0),
		downvotes: Number(downvotes?.n ?? 0),
		regenerations: Number(regenerations?.n ?? 0),
	};
}

const CONTEXT_FILE_READ_COST_LIMIT = 25;
const CHARS_PER_TOKEN = 4;

/** Aggregated read-token cost of a single context file over the analysis window. */
export async function getContextFileReadCosts(
	projectId: string,
	start: Date,
	end: Date,
): Promise<ContextFileReadCost[]> {
	const isPostgres = dbConfig.dialect === Dialect.Postgres;
	const filePath = isPostgres
		? sql<string>`${s.messagePart.toolInput}->>'file_path'`
		: sql<string>`json_extract(${s.messagePart.toolInput}, '$.file_path')`;
	const rawChars = isPostgres
		? sql<number>`length(${s.messagePart.toolOutput}->>'content')`
		: sql<number>`length(json_extract(${s.messagePart.toolOutput}, '$.content'))`;
	const cappedChars = isPostgres
		? sql<number>`least(${rawChars}, ${readFile.MODEL_OUTPUT_MAX_CHARS})`
		: sql<number>`min(${rawChars}, ${readFile.MODEL_OUTPUT_MAX_CHARS})`;
	const totalChars = sql<number>`coalesce(sum(${cappedChars}), 0)`;

	const analysisChatIds = () =>
		db
			.select({ id: s.contextRecommendationRun.chatId })
			.from(s.contextRecommendationRun)
			.where(
				and(eq(s.contextRecommendationRun.projectId, projectId), isNotNull(s.contextRecommendationRun.chatId)),
			);

	const rows = await db
		.select({
			filePath,
			readCount: sql<number>`count(*)`,
			totalChars,
			maxChars: sql<number>`coalesce(max(${cappedChars}), 0)`,
			maxRawChars: sql<number>`coalesce(max(${rawChars}), 0)`,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(
			and(
				eq(s.chat.projectId, projectId),
				notInArray(s.chat.id, analysisChatIds()),
				or(isNull(s.chatMessage.isForked), eq(s.chatMessage.isForked, false)),
				eq(s.messagePart.toolName, 'read'),
				eq(s.messagePart.toolState, 'output-available'),
				gte(s.messagePart.createdAt, start),
				lt(s.messagePart.createdAt, end),
			),
		)
		.groupBy(filePath)
		.orderBy(desc(totalChars))
		.limit(CONTEXT_FILE_READ_COST_LIMIT)
		.execute();

	return rows
		.filter((row): row is typeof row & { filePath: string } => Boolean(row.filePath))
		.map((row) => {
			const readCount = Number(row.readCount ?? 0);
			const totalTokens = Math.ceil(Number(row.totalChars ?? 0) / CHARS_PER_TOKEN);
			const maxTokens = Math.ceil(Number(row.maxChars ?? 0) / CHARS_PER_TOKEN);
			return {
				filePath: row.filePath,
				readCount,
				totalTokens,
				avgTokens: readCount > 0 ? Math.round(totalTokens / readCount) : 0,
				maxTokens,
				truncated: Number(row.maxRawChars ?? 0) > readFile.MODEL_OUTPUT_MAX_CHARS,
			};
		});
}

/** The earliest-created admin of a project, used to attribute scheduled runs. */
export async function getFirstProjectAdminUserId(projectId: string): Promise<string> {
	const [admin] = await db
		.select({ userId: s.projectMember.userId })
		.from(s.projectMember)
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.role, 'admin')))
		.orderBy(asc(s.projectMember.createdAt))
		.limit(1)
		.execute();
	if (!admin) {
		throw new Error(`No admin found for project ${projectId}`);
	}
	return admin.userId;
}

/** Returns title, owner id and owner name for a list of chat IDs, scoped to the project. */
export async function getRecommendationChatMetadata(
	projectId: string,
	chatIds: string[],
): Promise<{ chatId: string; title: string; userId: string; userName: string }[]> {
	if (chatIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({
			chatId: s.chat.id,
			title: s.chat.title,
			userId: s.chat.userId,
			userName: s.user.name,
		})
		.from(s.chat)
		.leftJoin(s.user, eq(s.user.id, s.chat.userId))
		.where(and(eq(s.chat.projectId, projectId), inArray(s.chat.id, chatIds)))
		.execute();
	return rows.map((row) => ({
		chatId: row.chatId,
		title: row.title,
		userId: row.userId,
		userName: row.userName ?? '',
	}));
}

/**
 * Resolves the canonical chatId for a set of trigger targets (message ids or tool
 * call ids), scoped to the project. Recommendation runs record trigger refs from LLM
 * output, which occasionally transcribes a chatId incorrectly; a targetId that maps to
 * a real message is the reliable source of truth for which chat a finding belongs to.
 */
export async function resolveTriggerTargetChatIds(
	projectId: string,
	targetIds: string[],
): Promise<Map<string, string>> {
	if (targetIds.length === 0) {
		return new Map();
	}
	const [byMessageId, byToolCallId] = await Promise.all([
		db
			.select({ targetId: s.chatMessage.id, chatId: s.chatMessage.chatId })
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(and(eq(s.chat.projectId, projectId), isNull(s.chat.deletedAt), inArray(s.chatMessage.id, targetIds)))
			.execute(),
		db
			.select({ targetId: s.messagePart.toolCallId, chatId: s.chatMessage.chatId })
			.from(s.messagePart)
			.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(
				and(
					eq(s.chat.projectId, projectId),
					isNull(s.chat.deletedAt),
					inArray(s.messagePart.toolCallId, targetIds),
				),
			)
			.execute(),
	]);
	const resolved = new Map<string, string>();
	for (const row of byMessageId) {
		resolved.set(row.targetId, row.chatId);
	}
	for (const row of byToolCallId) {
		if (row.targetId) {
			resolved.set(row.targetId, row.chatId);
		}
	}
	return resolved;
}

/** Returns the subset of the given chatIds that exist in the project. */
export async function filterExistingProjectChatIds(projectId: string, chatIds: string[]): Promise<Set<string>> {
	if (chatIds.length === 0) {
		return new Set();
	}
	const rows = await db
		.select({ id: s.chat.id })
		.from(s.chat)
		.where(and(eq(s.chat.projectId, projectId), isNull(s.chat.deletedAt), inArray(s.chat.id, chatIds)))
		.execute();
	return new Set(rows.map((row) => row.id));
}

/** Sum of token usage across every message of a run's chat. */
export async function getChatTokenTotals(
	chatId: string,
): Promise<{ inputTotalTokens: number; outputTotalTokens: number; totalTokens: number }> {
	const [row] = await db
		.select({
			inputTotalTokens: sql<number>`coalesce(sum(${s.chatMessage.inputTotalTokens}), 0)`,
			outputTotalTokens: sql<number>`coalesce(sum(${s.chatMessage.outputTotalTokens}), 0)`,
			totalTokens: sql<number>`coalesce(sum(${s.chatMessage.totalTokens}), 0)`,
		})
		.from(s.chatMessage)
		.where(eq(s.chatMessage.chatId, chatId))
		.execute();
	return {
		inputTotalTokens: Number(row?.inputTotalTokens ?? 0),
		outputTotalTokens: Number(row?.outputTotalTokens ?? 0),
		totalTokens: Number(row?.totalTokens ?? 0),
	};
}

export async function linkFeedbackToRecommendation(
	projectId: string,
	recommendationId: string,
	messageIds: string[],
	executor: DBExecutor = db,
): Promise<void> {
	const scopedMessageIds = await filterProjectMessageIds(projectId, messageIds, executor);
	if (scopedMessageIds.length === 0) {
		return;
	}
	const [recommendation] = await executor
		.select({ id: s.contextRecommendation.id })
		.from(s.contextRecommendation)
		.where(and(eq(s.contextRecommendation.id, recommendationId), eq(s.contextRecommendation.projectId, projectId)))
		.execute();
	if (!recommendation) {
		return;
	}
	await executor
		.insert(s.contextRecommendationLinkedFeedback)
		.values(scopedMessageIds.map((messageId) => ({ recommendationId, messageId })))
		.onConflictDoNothing()
		.execute();
}

export async function filterProjectMessageIds(
	projectId: string,
	messageIds: string[],
	executor: DBExecutor = db,
): Promise<string[]> {
	if (messageIds.length === 0) {
		return [];
	}
	const rows = await executor
		.select({ id: s.chatMessage.id })
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(and(eq(s.chat.projectId, projectId), isNull(s.chat.deletedAt), inArray(s.chatMessage.id, messageIds)))
		.execute();
	return rows.map((row) => row.id);
}

export interface FeedbackOwnershipRow {
	messageId: string;
	recommendationId: string;
	status: ContextRecommendationStatus;
	impactScore: number;
	createdAt: Date;
	insights: RecommendationInsight[];
}

export async function listAllFeedbackLinks(projectId: string): Promise<FeedbackOwnershipRow[]> {
	return db
		.select({
			messageId: s.contextRecommendationLinkedFeedback.messageId,
			recommendationId: s.contextRecommendationLinkedFeedback.recommendationId,
			status: s.contextRecommendation.status,
			impactScore: s.contextRecommendation.impactScore,
			createdAt: s.contextRecommendation.createdAt,
			insights: s.contextRecommendation.insights,
		})
		.from(s.contextRecommendationLinkedFeedback)
		.innerJoin(
			s.contextRecommendation,
			eq(s.contextRecommendation.id, s.contextRecommendationLinkedFeedback.recommendationId),
		)
		.where(eq(s.contextRecommendation.projectId, projectId))
		.execute();
}

export async function deleteFeedbackLinks(
	links: { recommendationId: string; messageId: string }[],
	executor: DBExecutor = db,
): Promise<void> {
	if (links.length === 0) {
		return;
	}
	await executor
		.delete(s.contextRecommendationLinkedFeedback)
		.where(
			or(
				...links.map((link) =>
					and(
						eq(s.contextRecommendationLinkedFeedback.recommendationId, link.recommendationId),
						eq(s.contextRecommendationLinkedFeedback.messageId, link.messageId),
					),
				),
			),
		)
		.execute();
}

export async function getUnlinkedNegativeFeedbacks(projectId: string): Promise<UnlinkedFeedback[]> {
	const rows = await db
		.select({
			messageId: s.messageFeedback.messageId,
			chatId: s.chatMessage.chatId,
			explanation: s.messageFeedback.explanation,
			createdAt: s.messageFeedback.createdAt,
			userName: s.user.name,
		})
		.from(s.messageFeedback)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messageFeedback.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.innerJoin(s.user, eq(s.user.id, s.chat.userId))
		.leftJoin(
			s.contextRecommendationLinkedFeedback,
			eq(s.contextRecommendationLinkedFeedback.messageId, s.messageFeedback.messageId),
		)
		.where(
			and(
				eq(s.chat.projectId, projectId),
				isNull(s.chat.deletedAt),
				eq(s.messageFeedback.vote, 'down'),
				isNull(s.contextRecommendationLinkedFeedback.messageId),
			),
		)
		.execute();
	return rows;
}

export async function listFeedbacksForRecommendations(projectId: string, recIds: string[]): Promise<FeedbackLink[]> {
	if (recIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({
			recommendationId: s.contextRecommendationLinkedFeedback.recommendationId,
			messageId: s.contextRecommendationLinkedFeedback.messageId,
			chatId: s.chatMessage.chatId,
			vote: s.messageFeedback.vote,
			explanation: s.messageFeedback.explanation,
			userName: s.user.name,
		})
		.from(s.contextRecommendationLinkedFeedback)
		.innerJoin(s.messageFeedback, eq(s.messageFeedback.messageId, s.contextRecommendationLinkedFeedback.messageId))
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.contextRecommendationLinkedFeedback.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.innerJoin(s.user, eq(s.user.id, s.chat.userId))
		.where(
			and(
				eq(s.chat.projectId, projectId),
				inArray(s.contextRecommendationLinkedFeedback.recommendationId, recIds),
			),
		)
		.execute();
	return rows;
}

export async function getRecommendationLinksForMessages(
	projectId: string,
	messageIds: string[],
): Promise<MessageRecommendationLink[]> {
	if (messageIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({
			messageId: s.contextRecommendationLinkedFeedback.messageId,
			recommendationId: s.contextRecommendation.id,
			title: s.contextRecommendation.title,
			status: s.contextRecommendation.status,
		})
		.from(s.contextRecommendationLinkedFeedback)
		.innerJoin(
			s.contextRecommendation,
			eq(s.contextRecommendation.id, s.contextRecommendationLinkedFeedback.recommendationId),
		)
		.where(
			and(
				eq(s.contextRecommendation.projectId, projectId),
				inArray(s.contextRecommendationLinkedFeedback.messageId, messageIds),
			),
		)
		.orderBy(desc(s.contextRecommendation.createdAt), asc(s.contextRecommendation.id))
		.execute();
	return rows;
}
