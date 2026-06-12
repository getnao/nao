import { LLM_PROVIDERS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { env } from '../env';
import { ensureContextRecommendationsSchedule } from '../handlers/context-recommendations.handler';
import * as crQueries from '../queries/context-recommendation.queries';
import * as userQueries from '../queries/user.queries';
import { createRecommendationPullRequest, resolveRecommendationRepo } from '../services/context-pr.service';
import { runContextRecommendations } from '../services/context-recommendations.service';
import * as github from '../services/github';
import {
	CONTEXT_RECOMMENDATION_FREQUENCIES,
	CONTEXT_RECOMMENDATION_STATUSES,
	MAX_AUTO_PRS_PER_RUN,
	MIN_AUTO_PRS_PER_RUN,
} from '../types/context-recommendation';
import { getProjectAvailableModels } from '../utils/llm';
import { logger } from '../utils/logger';
import { extractConfiguredRepos } from '../utils/nao-config';
import { adminProtectedProcedure } from './trpc';

const MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH = 4000;

const recommendationsProcedure = adminProtectedProcedure.use(async ({ next }) => {
	if (!env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Context recommendations are disabled on this instance.' });
	}
	return next();
});

export const contextRecommendationRoutes = {
	list: recommendationsProcedure
		.input(z.object({ status: z.enum(CONTEXT_RECOMMENDATION_STATUSES).optional() }).optional())
		.query(async ({ ctx, input }) => crQueries.listRecommendations(ctx.project.id, input?.status)),

	latestRun: recommendationsProcedure.query(async ({ ctx }) => crQueries.getLatestRun(ctx.project.id)),

	run: recommendationsProcedure.mutation(async ({ ctx }) => {
		const latestRun = await crQueries.getLatestRun(ctx.project.id);
		if (latestRun?.status === 'running') {
			throw new TRPCError({ code: 'CONFLICT', message: 'A recommendations run is already in progress.' });
		}
		void runContextRecommendations(ctx.project.id, { trigger: 'manual' }).catch((err) => {
			logger.error(`Manual context recommendations run failed: ${String(err)}`, { source: 'agent' });
		});
		return { started: true };
	}),

	listAvailableModels: recommendationsProcedure.query(async ({ ctx }) => getProjectAvailableModels(ctx.project.id)),

	getConfig: recommendationsProcedure.query(async ({ ctx }) => {
		return crQueries.getConfig(ctx.project.id);
	}),

	setConfig: recommendationsProcedure
		.input(
			z.object({
				modelProvider: z.enum(LLM_PROVIDERS).optional(),
				modelId: z.string().optional(),
				frequency: z.enum(CONTEXT_RECOMMENDATION_FREQUENCIES).optional(),
				customSystemPromptInstructions: z.string().max(MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH).optional(),
				autoCreatePrs: z.boolean().optional(),
				maxAutoPrsPerRun: z.number().int().min(MIN_AUTO_PRS_PER_RUN).max(MAX_AUTO_PRS_PER_RUN).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const customSystemPromptInstructions =
				'customSystemPromptInstructions' in input
					? input.customSystemPromptInstructions?.trim() || null
					: undefined;
			await crQueries.updateConfig(ctx.project.id, {
				modelProvider: input.modelProvider,
				modelId: input.modelId,
				frequency: input.frequency,
				customSystemPromptInstructions,
				autoCreatePrs: input.autoCreatePrs,
				maxAutoPrsPerRun: input.maxAutoPrsPerRun,
			});
			if (input.frequency) {
				await ensureContextRecommendationsSchedule(ctx.project.id, input.frequency, { reset: true });
			}
		}),

	getRepo: recommendationsProcedure.query(async ({ ctx }) => resolveRecommendationRepo(ctx.project.id)),

	listLinkedRepos: recommendationsProcedure.query(async ({ ctx }) => {
		if (!ctx.project.path) {
			return [];
		}
		return extractConfiguredRepos(ctx.project.path);
	}),

	setRepo: recommendationsProcedure
		.input(
			z.object({
				repoFullName: z
					.string()
					.regex(/^[\w.-]+\/[\w.-]+$/, 'Expected a repository in "owner/name" format')
					.nullable(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await crQueries.updateConfig(ctx.project.id, { repoFullName: input.repoFullName });
		}),

	setStatus: recommendationsProcedure
		.input(
			z.object({
				id: z.string(),
				status: z.enum(CONTEXT_RECOMMENDATION_STATUSES),
				snoozedUntil: z.number().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await crQueries.setRecommendationStatus({
				id: input.id,
				projectId: ctx.project.id,
				status: input.status,
				snoozedUntil: input.snoozedUntil ? new Date(input.snoozedUntil) : null,
				userId: ctx.user.id,
			});
		}),

	getPrStatus: recommendationsProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const rec = await crQueries.getRecommendationById(ctx.project.id, input.id);
		if (!rec?.prUrl) {
			return null;
		}
		const parsed = github.parsePullRequestUrl(rec.prUrl);
		if (!parsed) {
			return null;
		}
		const token = await userQueries.getGithubToken(ctx.user.id);
		if (!token) {
			return null;
		}
		try {
			const pr = await github.getPullRequest(token, parsed.repo, parsed.number);
			return { state: pr.state, mergedAt: pr.merged_at, htmlUrl: pr.html_url };
		} catch (err) {
			logger.warn(`Failed to fetch PR status for recommendation ${input.id}: ${String(err)}`, {
				source: 'agent',
			});
			return null;
		}
	}),

	createPullRequest: recommendationsProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		try {
			return await createRecommendationPullRequest(ctx.project.id, input.id, ctx.user.id);
		} catch (err) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: err instanceof Error ? err.message : 'Failed to create pull request',
			});
		}
	}),
};
