import type { ContextRecommendationApplyResult } from '@nao/shared/context-editor';
import {
	CONTEXT_RECOMMENDATION_CATEGORY_LABELS,
	normalizeContextRecommendationCategory,
} from '@nao/shared/context-recommendation';
import { z } from 'zod/v4';

import type { DBContextRecommendation } from '../db/abstractSchema';
import * as crQueries from '../queries/context-recommendation.queries';
import { CONTEXT_RECOMMENDATION_STATUSES, type ContextRecommendationStatus } from '../types/context-recommendation';
import { HandlerError } from '../utils/error';
import { createTool } from '../utils/tools';
import { applyRecommendationToChanges, extractChangedSnippet } from './context-recommendation-apply.service';

interface ContextEditor {
	id: string;
	name: string;
	email: string;
}

interface RecommendationSummary {
	id: string;
	title: string;
	summary: string;
	category: string;
	status: ContextRecommendationStatus;
	affectedChats: number | null;
	/** Context files the proposed edits change, empty when the fix is guidance to follow by hand. */
	files: string[];
	hasProposedEdits: boolean;
}

interface ListRecommendationsOutput {
	recommendations: RecommendationSummary[];
	totalCount: number;
}

interface RecommendationDetail extends RecommendationSummary {
	rootCause: string | null;
	fixGuidance: string | null;
	edits: {
		path: string;
		kind: 'edit' | 'create';
		linkedRepository: string | null;
		removed: string;
		added: string;
	}[];
	signals: { metric: string; count: number; snippet: string | null }[];
}

interface SetRecommendationStatusOutput {
	recommendationId: string;
	title: string;
	status: ContextRecommendationStatus;
}

const MAX_LISTED_RECOMMENDATIONS = 20;

const recommendationIdSchema = z
	.string()
	.trim()
	.min(1)
	.describe('Recommendation id, from `list_recommendations.recommendations[].id`.');

const listInputSchema = z.object({
	status: z
		.enum(CONTEXT_RECOMMENDATION_STATUSES)
		.optional()
		.describe('Only recommendations with this status, `open` by default: the ones still to handle.'),
	path: z
		.string()
		.trim()
		.max(2_000)
		.optional()
		.describe('Only recommendations changing this context file, e.g. the file the user has open.'),
});

const setStatusInputSchema = z.object({
	recommendation_id: recommendationIdSchema,
	status: z.enum(CONTEXT_RECOMMENDATION_STATUSES),
});

/**
 * Tools giving the Context Hub chat the recommendations nao derived from how people use the project: what to improve
 * in the context, with the file edits proposed to do it, which it applies in the user's changes like its own edits.
 */
export function createContextEditorRecommendationTools(editor: ContextEditor) {
	return {
		list_recommendations: createTool<z.infer<typeof listInputSchema>, ListRecommendationsOutput>({
			description:
				'List the recommendations nao derived from real chats (tool errors, downvotes, corrections, coverage gaps) to improve the context, highest impact first.',
			inputSchema: listInputSchema,
			execute: async ({ status = 'open', path }, context) => {
				const recommendations = (await crQueries.listRecommendations(context.projectId, status))
					.map(toRecommendationSummary)
					.filter((recommendation) => !path || recommendation.files.includes(toExplorerPath(path)));
				return {
					recommendations: recommendations.slice(0, MAX_LISTED_RECOMMENDATIONS),
					totalCount: recommendations.length,
				};
			},
		}),
		get_recommendation: createTool<{ recommendation_id: string }, RecommendationDetail>({
			description:
				'Read one recommendation: why nao suggests it, the signals from chats behind it and the exact edits it proposes, each as the text it removes and the text it adds.',
			inputSchema: z.object({ recommendation_id: recommendationIdSchema }),
			execute: async ({ recommendation_id }, context) =>
				toRecommendationDetail(await getRecommendation(context.projectId, recommendation_id)),
		}),
		apply_recommendation: createTool<{ recommendation_id: string }, ContextRecommendationApplyResult>({
			description:
				'Write the edits a recommendation proposes into the user’s changes, like edit_context_file, and mark it applied once they all landed. Edits that no longer fit the file are returned as conflicts: apply those with edit_context_file.',
			inputSchema: z.object({ recommendation_id: recommendationIdSchema }),
			execute: async ({ recommendation_id }, context) =>
				applyRecommendationToChanges({
					projectId: context.projectId,
					projectFolder: context.projectFolder,
					editor,
					recommendationId: recommendation_id,
				}),
		}),
		set_recommendation_status: createTool<z.infer<typeof setStatusInputSchema>, SetRecommendationStatusOutput>({
			description:
				'Change the status of a recommendation: `applied` once its fix is in the user’s changes, `dismissed` when the user does not want it, which stops nao from suggesting it, or `open` to handle it again.',
			inputSchema: setStatusInputSchema,
			execute: async ({ recommendation_id, status }, context) => {
				const recommendation = await getRecommendation(context.projectId, recommendation_id);
				await crQueries.setRecommendationStatus({
					id: recommendation.id,
					projectId: context.projectId,
					status,
					userId: editor.id,
				});
				return { recommendationId: recommendation.id, title: recommendation.title, status };
			},
		}),
	};
}

async function getRecommendation(projectId: string, recommendationId: string): Promise<DBContextRecommendation> {
	const recommendation = await crQueries.getRecommendationById(projectId, recommendationId);
	if (!recommendation) {
		throw new HandlerError('NOT_FOUND', `Recommendation ${recommendationId} not found in this project.`);
	}
	return recommendation;
}

function toRecommendationSummary(recommendation: DBContextRecommendation): RecommendationSummary {
	const edits = recommendation.fixKind === 'patch' ? (recommendation.proposedEdits ?? []) : [];
	return {
		id: recommendation.id,
		title: recommendation.title,
		summary: recommendation.summary,
		category:
			CONTEXT_RECOMMENDATION_CATEGORY_LABELS[normalizeContextRecommendationCategory(recommendation.category)],
		status: recommendation.status,
		affectedChats: recommendation.impact?.affectedChats ?? null,
		files: edits.filter((edit) => !edit.targetRepo).map((edit) => toExplorerPath(edit.path)),
		hasProposedEdits: edits.length > 0,
	};
}

function toRecommendationDetail(recommendation: DBContextRecommendation): RecommendationDetail {
	const edits = recommendation.fixKind === 'patch' ? (recommendation.proposedEdits ?? []) : [];
	return {
		...toRecommendationSummary(recommendation),
		rootCause: recommendation.rootCause,
		fixGuidance: recommendation.fixGuidance,
		edits: edits.map((edit) => ({
			path: toExplorerPath(edit.path),
			kind: edit.kind,
			linkedRepository: edit.targetRepo?.repoFullName ?? null,
			...extractChangedSnippet(edit.oldContent, edit.newContent),
		})),
		signals: recommendation.insights.map((insight) => ({
			metric: insight.metric,
			count: insight.count,
			snippet: insight.snippet ?? null,
		})),
	};
}

function toExplorerPath(path: string): string {
	return `/${path.replace(/^\/+/, '')}`;
}
