import { LlmSelectedModel } from '@nao/shared/types';
import { readUIMessageStream, UIMessage } from 'ai';
import { and, desc, eq } from 'drizzle-orm';

import { getTools } from '../agents/tools';
import { ContextFixCollector, createContextFixCollector } from '../agents/tools/propose-context-fix';
import { createQueryAppDbTool } from '../agents/tools/query-app-db';
import { createRecommendationCollector } from '../agents/tools/record-recommendation';
import { renderContextRecommendationsPrompt, renderContextRecommendationsSystemPrompt } from '../components/ai';
import s, {
	DBContextRecommendation,
	DBContextRecommendationConfig,
	NewContextRecommendation,
} from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import * as chatQueries from '../queries/chat.queries';
import * as crQueries from '../queries/context-recommendation.queries';
import * as projectQueries from '../queries/project.queries';
import { DEFAULT_MAX_AUTO_PRS_PER_RUN } from '../types/context-recommendation';
import { logger } from '../utils/logger';
import { extractConfiguredRepos } from '../utils/nao-config';
import { agentService } from './agent';
import { autoCreateRecommendationPullRequests, resolveRecommendationRepo } from './context-pr.service';
import {
	ExistingRecommendation,
	fingerprintFor,
	reconcile,
	ReconcileAction,
} from './context-recommendations.reconcile';

const DEFAULT_LOOKBACK_DAYS = 90;
const IMPACT_FLOOR = 5;
const ANALYSIS_STEP_BUDGET = 40;

export async function runContextRecommendations(
	projectId: string,
	options?: { trigger?: 'schedule' | 'manual'; period?: { start?: Date; end?: Date } },
): Promise<{ runId: string }> {
	const period = options?.period;
	const now = new Date();
	const periodEnd = period?.end ?? now;
	const periodStart = period?.start ?? (await resolvePeriodStart(projectId, periodEnd));

	const config = await crQueries.getConfig(projectId);
	const model = await agentService.resolveModelSelection(projectId, resolveConfiguredModel(config));

	const run = await crQueries.createRun({
		projectId,
		trigger: options?.trigger ?? 'schedule',
		windowStart: periodStart,
		windowEnd: periodEnd,
		llmProvider: model.provider,
		llmModelId: model.modelId,
	});

	try {
		const project = await projectQueries.getProjectById(projectId);
		const linkedRepos = project?.path ? extractConfiguredRepos(project.path) : [];
		const contextRepo = await resolveRecommendationRepo(projectId);
		const proposeFixes = !!project?.path && (!!contextRepo || linkedRepos.some((repo) => repo.repoFullName));
		const fixCollector = proposeFixes
			? createContextFixCollector(project!.path!, linkedRepos, { allowContextEdits: !!contextRepo })
			: null;

		const existing = await crQueries.getReconcilableRecommendations(projectId);
		const dismissedFingerprints = await crQueries.getDismissedFingerprints(projectId);
		const totals = await crQueries.getWindowTotals(projectId, periodStart, periodEnd);

		const userId = await crQueries.getFirstProjectAdminUserId(projectId);
		const [chat] = await chatQueries.createChat(
			{ title: 'Context recommendations run', userId, projectId },
			{
				text: renderContextRecommendationsPrompt({
					windowStart: periodStart,
					windowEnd: periodEnd,
					existing,
					proposeFixes,
					linkedRepos,
					contextRepoConnected: !!contextRepo,
				}),
				source: 'contextRecommendations',
			},
		);
		await crQueries.setRunChat(run.id, chat.id);

		const [uiChat] = await chatQueries.getChat(chat.id);
		if (!uiChat) {
			throw new Error(`Failed to load run chat ${chat.id}`);
		}

		const collector = createRecommendationCollector();
		const agent = await agentService.create({ ...uiChat, id: chat.id, projectId, userId }, model, {
			excludeFollowUps: true,
			maxSteps: ANALYSIS_STEP_BUDGET,
			systemPrompt: renderContextRecommendationsSystemPrompt({
				proposeFixes,
				linkedRepos,
				contextRepoConnected: !!contextRepo,
				customInstructions: config?.customSystemPromptInstructions ?? undefined,
			}),
			tools: ({ agentSettings }) =>
				getTools(
					agentSettings,
					{
						query_app_db: createQueryAppDbTool(projectId),
						record_recommendation: collector.recordTool,
						resolve_recommendation: collector.resolveTool,
						...(fixCollector && {
							edit_file: fixCollector.editTool,
							propose_manual_fix: fixCollector.manualFixTool,
						}),
					},
					{ excludeFollowUps: true, builtinToolAllowlist: ['read', 'grep', 'list', 'search'] },
				),
		});

		const stream = agent.stream(uiChat.messages ?? [], {});
		for await (const message of readUIMessageStream<UIMessage>({ stream })) {
			void message; // drain; the agent persists its own messages, tools mutate the collector by reference
		}

		const actions = reconcile({
			existing: existing.map(toExistingRec),
			recorded: collector.recorded,
			resolvedFingerprints: collector.resolvedFingerprints,
			dismissedFingerprints,
			totals,
			impactFloor: IMPACT_FLOOR,
			now,
		});

		const tokens = await crQueries.getChatTokenTotals(chat.id);
		await db.transaction(async (tx) => {
			await applyActions({ projectId, runId: run.id, model, actions, existing, fixCollector }, tx);
		});

		// YOLO mode: open PRs for the top recommendations before the run is marked
		// completed, so the UI refresh at completion already shows them as applied.
		if (proposeFixes && config?.autoCreatePrs) {
			await autoCreateRecommendationPullRequests(
				projectId,
				userId,
				config.maxAutoPrsPerRun ?? DEFAULT_MAX_AUTO_PRS_PER_RUN,
			);
		}

		await crQueries.completeRun(run.id, { ...tokens, llmProvider: model.provider, llmModelId: model.modelId });
		return { runId: run.id };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Context recommendations run failed: ${message}`, { source: 'agent' });
		await crQueries.failRun(run.id, message);
		throw err;
	}
}

function resolveConfiguredModel(config: DBContextRecommendationConfig | null): LlmSelectedModel | undefined {
	if (config?.modelProvider && config?.modelId) {
		return { provider: config.modelProvider, modelId: config.modelId };
	}
	return undefined; // agentService resolves the project default
}

async function resolvePeriodStart(projectId: string, end: Date): Promise<Date> {
	const [last] = await db
		.select({ completedAt: s.contextRecommendationRun.completedAt })
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
	if (last?.completedAt) {
		return last.completedAt;
	}
	return new Date(end.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

/** Pulls the agent-proposed fix for a finding, if any, into a persistable patch. */
function resolveFix(
	collector: ContextFixCollector | null,
	suggestedFile: string,
	subjectKey: string,
): Partial<NewContextRecommendation> {
	if (!collector) {
		return {};
	}
	const fix = collector.getFix(fingerprintFor(suggestedFile, subjectKey));
	if (!fix) {
		return {};
	}
	return {
		fixKind: fix.fixKind,
		proposedEdits: fix.proposedEdits,
		fixGuidance: fix.fixGuidance,
		fixPrompt: fix.fixPrompt,
	};
}

function toExistingRec(r: DBContextRecommendation): ExistingRecommendation {
	return {
		id: r.id,
		fingerprint: r.fingerprint,
		status: r.status,
		snoozedUntil: r.snoozedUntil,
		occurrenceCount: r.occurrenceCount,
	};
}

async function applyActions(
	args: {
		projectId: string;
		runId: string;
		model: LlmSelectedModel;
		actions: ReconcileAction[];
		existing: DBContextRecommendation[];
		fixCollector: ContextFixCollector | null;
	},
	executor: DBExecutor,
): Promise<void> {
	const byId = new Map(args.existing.map((r) => [r.id, r]));
	for (const action of args.actions) {
		if (action.kind === 'insert') {
			await crQueries.insertRecommendation(
				{
					projectId: args.projectId,
					fingerprint: action.fingerprint,
					suggestedFile: action.finding.suggestedFile,
					subjectKey: action.finding.subjectKey,
					...upsertFields(action, args),
				},
				executor,
			);
		} else if (action.kind === 'update') {
			const prev = byId.get(action.id);
			const patch: Partial<NewContextRecommendation> = {
				...upsertFields(action, args),
				occurrenceCount: (prev?.occurrenceCount ?? 1) + 1,
			};
			if (action.reopen) {
				patch.status = 'open';
			}
			await crQueries.updateRecommendation(action.id, patch, executor);
		} else if (action.kind === 'resolve') {
			await crQueries.updateRecommendation(
				action.id,
				{ status: 'applied', statusChangedAt: new Date() },
				executor,
			);
		}
	}
}

/** Fields written identically whether a finding is inserted or updated. */
function upsertFields(
	action: Extract<ReconcileAction, { kind: 'insert' | 'update' }>,
	args: { runId: string; model: LlmSelectedModel; fixCollector: ContextFixCollector | null },
) {
	return {
		runId: args.runId,
		severity: action.finding.severity,
		impactScore: action.impactScore,
		impact: action.impact,
		insights: action.finding.insights,
		title: action.finding.title,
		summary: action.finding.summary,
		suggestedAction: action.finding.suggestedAction,
		...resolveFix(args.fixCollector, action.finding.suggestedFile, action.finding.subjectKey),
		llmProvider: args.model.provider,
		llmModelId: args.model.modelId,
	};
}
