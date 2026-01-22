import { z } from 'zod/v4';

import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

const llmProviderSchema = z.enum(['openai', 'anthropic']);

export const projectRoutes = {
	getCurrent: projectProtectedProcedure.query(({ ctx }) => {
		if (!ctx.project) {
			return null;
		}
		return {
			...ctx.project,
			userRole: ctx.userRole,
		};
	}),

	getModelProvider: projectProtectedProcedure.query(async ({ ctx }) => {
		const { project } = ctx;
		return project ? await llmConfigQueries.getProjectModelProvider(project.id) : undefined;
	}),

	getLlmConfigs: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { projectConfigs: [], envProviders: [] };
		}

		const configs = await llmConfigQueries.getProjectLlmConfigs(ctx.project.id);

		const projectConfigs = configs.map((c) => ({
			id: c.id,
			provider: c.provider,
			apiKeyPreview: c.apiKey.slice(0, 8) + '...' + c.apiKey.slice(-4),
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		}));

		const envProviders: ('anthropic' | 'openai')[] = [];
		if (process.env.ANTHROPIC_API_KEY) envProviders.push('anthropic');
		if (process.env.OPENAI_API_KEY) envProviders.push('openai');

		return { projectConfigs, envProviders };
	}),

	upsertLlmConfig: adminProtectedProcedure
		.input(
			z.object({
				provider: llmProviderSchema,
				apiKey: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await llmConfigQueries.upsertProjectLlmConfig({
				projectId: ctx.project.id,
				provider: input.provider,
				apiKey: input.apiKey,
			});
			return {
				id: config.id,
				provider: config.provider,
				apiKeyPreview: config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4),
			};
		}),

	deleteLlmConfig: adminProtectedProcedure
		.input(z.object({ provider: llmProviderSchema }))
		.mutation(async ({ ctx, input }) => {
			await llmConfigQueries.deleteProjectLlmConfig(ctx.project.id, input.provider);
			return { success: true };
		}),

	getSlackConfig: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { projectConfig: null, hasEnvConfig: false };
		}

		const config = await slackConfigQueries.getProjectSlackConfig(ctx.project.id);

		const hasEnvConfig = !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET);

		const projectConfig = config
			? {
					botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
					signingSecretPreview: config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4),
				}
			: null;

		const baseUrl = process.env.REDIRECT_URL || '';
		return {
			projectConfig,
			hasEnvConfig,
			redirectUrl: baseUrl,
			projectId: ctx.project.id,
		};
	}),

	upsertSlackConfig: adminProtectedProcedure
		.input(
			z.object({
				botToken: z.string().min(1),
				signingSecret: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await slackConfigQueries.upsertProjectSlackConfig({
				projectId: ctx.project.id,
				botToken: input.botToken,
				signingSecret: input.signingSecret,
			});
			return {
				botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
				signingSecretPreview: config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4),
			};
		}),

	deleteSlackConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await slackConfigQueries.deleteProjectSlackConfig(ctx.project.id);
		return { success: true };
	}),
};
