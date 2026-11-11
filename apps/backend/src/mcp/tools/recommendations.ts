import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	CONTEXT_RECOMMENDATION_CATEGORY_LABELS,
	normalizeContextRecommendationCategory,
} from '@nao/shared/context-recommendation';
import { z } from 'zod';

import type { DBContextRecommendation } from '../../db/abstractSchema';
import * as crQueries from '../../queries/context-recommendation.queries';
import { resolveRecommendationRepo } from '../../services/context-pr.service';
import { buildAgentPrompt } from '../../services/context-recommendation-prompt';
import { repairRecommendationTriggerRefs } from '../../services/context-recommendations.service';
import { CONTEXT_RECOMMENDATION_CATEGORIES, CONTEXT_RECOMMENDATION_STATUSES } from '../../types/context-recommendation';
import type { McpContext } from '../logging';
import { jsonToolResult, registerMcpTool } from './register-mcp-tool';

const LIST_RECOMMENDATIONS_DESCRIPTION =
	'List the context recommendations nao derived from how people use this project (admins and context admins only).\n\n' +
	'A recommendation is a suggested change to the agent context (RULES.md, docs, data model, semantic layer, skills) ' +
	'backed by signals from real chats: tool errors, downvotes, repeated corrections, coverage gaps.\n' +
	'USE WHEN: you want to review what to improve in the nao context, by category or status.\n' +
	'Returns summaries ranked by impact, plus the count per category. Call `get_recommendation` for the full fix.';

const GET_RECOMMENDATION_DESCRIPTION =
	'Fetch one context recommendation with everything needed to apply it: root cause, the signals and chats ' +
	'that triggered it, the proposed file edits or fix guidance, user feedback, and `agentPrompt`, a ready-to-run ' +
	'prompt to apply the fix in the context repository (admins and context admins only).\n\n' +
	'Pass a `chatId` from `insights[].triggerRefs` to `get_chat` to read a chat that triggered it.\n' +
	'After applying the fix, call `set_recommendation_status` with `applied`.';

const SET_RECOMMENDATION_STATUS_DESCRIPTION =
	'Change the status of a context recommendation (admins and context admins only).\n\n' +
	'`applied`: the fix is in the context. `dismissed`: it will not be applied; nao stops suggesting it. ' +
	'`open`: back to the list of recommendations to handle.\n' +
	'USE WHEN: you applied the fix (e.g. from `get_recommendation.agentPrompt`) or the user decided to dismiss it.';

const RECOMMENDATION_ID_INPUT = z
	.string()
	.describe('Recommendation UUID, from `list_recommendations.recommendations[].id`.');

const RECOMMENDATION_SUMMARY_SCHEMA = z.object({
	id: z.string(),
	title: z.string(),
	summary: z.string(),
	category: z.enum(CONTEXT_RECOMMENDATION_CATEGORIES),
	categoryLabel: z.string(),
	status: z.enum(CONTEXT_RECOMMENDATION_STATUSES),
	impactScore: z.number().describe('Ranking score: the higher, the more chats it would improve.'),
	affectedChats: z.number().nullable(),
	suggestedFile: z.string().describe('Context file the fix targets.'),
	suggestedAction: z.string(),
	fixKind: z.string().nullable().describe('`patch` when nao proposes file edits, `manual` when it gives guidance.'),
	fixTarget: z.string().nullable(),
	occurrenceCount: z.number().describe('Number of analysis runs that surfaced it.'),
	firstSeenAt: z.string(),
	lastSeenAt: z.string(),
	prUrl: z.string().nullable().describe('Pull request opened from nao to apply it, if any.'),
});

const RECOMMENDATION_DETAIL_SCHEMA = {
	...RECOMMENDATION_SUMMARY_SCHEMA.shape,
	rootCause: z.string().nullable(),
	rootCauseKind: z.string().nullable(),
	insights: z
		.array(
			z.object({
				signalType: z.string(),
				metric: z.string(),
				count: z.number(),
				snippet: z.string().optional(),
				triggerRefs: z.array(z.object({ chatId: z.string(), targetId: z.string().optional() })).optional(),
			}),
		)
		.describe('Usage signals behind the recommendation, with the chats that triggered them.'),
	proposedEdits: z
		.array(
			z.object({
				path: z.string(),
				kind: z.enum(['edit', 'create']),
				oldContent: z.string(),
				newContent: z.string(),
				targetRepo: z
					.object({
						repoFullName: z.string(),
						branch: z.string().nullable(),
						path: z.string(),
						provider: z.string(),
					})
					.optional()
					.describe('Set when the edit targets a linked repository instead of the context repository.'),
			}),
		)
		.nullable()
		.describe('File edits that apply the fix, when `fixKind` is `patch`.'),
	fixGuidance: z.string().nullable(),
	feedbacks: z
		.array(
			z.object({
				chatId: z.string(),
				messageId: z.string(),
				vote: z.enum(['up', 'down']),
				explanation: z.string().nullable(),
				userName: z.string(),
			}),
		)
		.describe('User feedback linked to the recommendation.'),
	statusChangedAt: z.string().nullable(),
	agentPrompt: z.string().describe('Prompt that applies the fix in the context repository.'),
};

type RecommendationSummary = z.infer<typeof RECOMMENDATION_SUMMARY_SCHEMA>;

export function registerRecommendationTools(server: McpServer, ctx: McpContext): void {
	registerListRecommendations(server, ctx);
	registerGetRecommendation(server, ctx);
	registerSetRecommendationStatus(server, ctx);
}

function registerListRecommendations(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'list_recommendations',
		title: 'List Recommendations',
		description: LIST_RECOMMENDATIONS_DESCRIPTION,
		inputSchema: {
			status: z
				.enum(CONTEXT_RECOMMENDATION_STATUSES)
				.optional()
				.describe(
					'Only recommendations with this status. Omit to list every status; `open` ones are to handle.',
				),
			category: z
				.enum(CONTEXT_RECOMMENDATION_CATEGORIES)
				.optional()
				.describe(`Only recommendations of this category: ${describeCategories()}.`),
		},
		outputSchema: {
			recommendations: z.array(RECOMMENDATION_SUMMARY_SCHEMA).describe('Highest impact first.'),
			categories: z
				.array(
					z.object({
						category: z.enum(CONTEXT_RECOMMENDATION_CATEGORIES),
						label: z.string(),
						count: z.number(),
					}),
				)
				.describe(
					'Number of recommendations per category for the requested status, before the category filter.',
				),
		},
		handler: async ({ status, category }) => {
			const recommendations = (await crQueries.listRecommendations(ctx.projectId, status)).map(
				toRecommendationSummary,
			);
			const output = {
				recommendations: category
					? recommendations.filter((recommendation) => recommendation.category === category)
					: recommendations,
				categories: countByCategory(recommendations),
			};
			return jsonToolResult(output);
		},
	});
}

function registerGetRecommendation(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'get_recommendation',
		title: 'Get Recommendation',
		description: GET_RECOMMENDATION_DESCRIPTION,
		inputSchema: { recommendation_id: RECOMMENDATION_ID_INPUT },
		outputSchema: RECOMMENDATION_DETAIL_SCHEMA,
		errorMessage: (error) => (error instanceof Error ? error.message : 'get_recommendation failed.'),
		handler: async ({ recommendation_id }) => {
			const recommendation = await retrieveRecommendation(ctx, recommendation_id);
			const [[repaired], feedbacks, repo] = await Promise.all([
				repairRecommendationTriggerRefs(ctx.projectId, [recommendation]),
				crQueries.listFeedbacksForRecommendations(ctx.projectId, [recommendation.id]),
				resolveRecommendationRepo(ctx.projectId, ctx.userId),
			]);
			const output = {
				...toRecommendationSummary(repaired),
				rootCause: repaired.rootCause,
				rootCauseKind: repaired.rootCauseKind,
				insights: repaired.insights,
				proposedEdits: repaired.proposedEdits ?? null,
				fixGuidance: repaired.fixGuidance,
				feedbacks: feedbacks.map(({ recommendationId: _recommendationId, ...feedback }) => feedback),
				statusChangedAt: repaired.statusChangedAt?.toISOString() ?? null,
				agentPrompt: buildAgentPrompt([repaired], repo?.subPath ?? ''),
			};
			return jsonToolResult(output);
		},
	});
}

function registerSetRecommendationStatus(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'set_recommendation_status',
		title: 'Set Recommendation Status',
		description: SET_RECOMMENDATION_STATUS_DESCRIPTION,
		inputSchema: {
			recommendation_id: RECOMMENDATION_ID_INPUT,
			status: z.enum(CONTEXT_RECOMMENDATION_STATUSES),
		},
		outputSchema: {
			id: z.string(),
			status: z.enum(CONTEXT_RECOMMENDATION_STATUSES),
		},
		errorMessage: (error) => (error instanceof Error ? error.message : 'set_recommendation_status failed.'),
		handler: async ({ recommendation_id, status }) => {
			const recommendation = await retrieveRecommendation(ctx, recommendation_id);
			await crQueries.setRecommendationStatus({
				id: recommendation.id,
				projectId: ctx.projectId,
				status,
				userId: ctx.userId,
			});
			return jsonToolResult({ id: recommendation.id, status });
		},
	});
}

async function retrieveRecommendation(ctx: McpContext, recommendationId: string): Promise<DBContextRecommendation> {
	const recommendation = await crQueries.getRecommendationById(ctx.projectId, recommendationId);
	if (!recommendation) {
		throw new Error(`Recommendation ${recommendationId} not found in this project.`);
	}
	return recommendation;
}

function toRecommendationSummary(recommendation: DBContextRecommendation): RecommendationSummary {
	const category = normalizeContextRecommendationCategory(recommendation.category);
	return {
		id: recommendation.id,
		title: recommendation.title,
		summary: recommendation.summary,
		category,
		categoryLabel: CONTEXT_RECOMMENDATION_CATEGORY_LABELS[category],
		status: recommendation.status,
		impactScore: recommendation.impactScore,
		affectedChats: recommendation.impact?.affectedChats ?? null,
		suggestedFile: recommendation.suggestedFile,
		suggestedAction: recommendation.suggestedAction,
		fixKind: recommendation.fixKind,
		fixTarget: recommendation.fixTarget,
		occurrenceCount: recommendation.occurrenceCount,
		firstSeenAt: recommendation.firstSeenAt.toISOString(),
		lastSeenAt: recommendation.lastSeenAt.toISOString(),
		prUrl: recommendation.prUrl,
	};
}

function countByCategory(recommendations: RecommendationSummary[]) {
	return CONTEXT_RECOMMENDATION_CATEGORIES.map((category) => ({
		category,
		label: CONTEXT_RECOMMENDATION_CATEGORY_LABELS[category],
		count: recommendations.filter((recommendation) => recommendation.category === category).length,
	}));
}

function describeCategories(): string {
	return CONTEXT_RECOMMENDATION_CATEGORIES.map(
		(category) => `\`${category}\` (${CONTEXT_RECOMMENDATION_CATEGORY_LABELS[category]})`,
	).join(', ');
}
