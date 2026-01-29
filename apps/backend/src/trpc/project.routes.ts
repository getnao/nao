import { z } from 'zod/v4';

import { KNOWN_MODELS } from '../agents/providers';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { llmConfigSchema, LlmProvider, llmProviderSchema } from '../types/llm';
import { getEnvApiKey, getEnvProviders, getProjectAvailableModels } from '../utils/llm';
import { adminProtectedProcedure, projectProtectedProcedure, publicProcedure } from './trpc';

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

	getLlmConfigs: projectProtectedProcedure
		.output(
			z.object({
				projectConfigs: z.array(llmConfigSchema),
				envProviders: z.array(llmProviderSchema),
			}),
		)
		.query(async ({ ctx }) => {
			if (!ctx.project) {
				return { projectConfigs: [], envProviders: [] };
			}

			const configs = await llmConfigQueries.getProjectLlmConfigs(ctx.project.id);

			const projectConfigs = configs.map((c) => ({
				id: c.id,
				provider: c.provider as LlmProvider,
				apiKeyPreview: c.apiKey.slice(0, 8) + '...' + c.apiKey.slice(-4),
				enabledModels: c.enabledModels ?? [],
				baseUrl: c.baseUrl ?? null,
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			}));

			return { projectConfigs, envProviders: getEnvProviders() };
		}),

	/** Get all available models for the current project (for user model selection) */
	getAvailableModels: projectProtectedProcedure
		.output(
			z.array(
				z.object({
					provider: llmProviderSchema,
					modelId: z.string(),
				}),
			),
		)
		.query(async ({ ctx }) => {
			if (!ctx.project) {
				return [];
			}
			return getProjectAvailableModels(ctx.project.id);
		}),

	upsertLlmConfig: adminProtectedProcedure
		.input(
			z.object({
				provider: llmProviderSchema,
				apiKey: z.string().min(1).optional(), // Optional - if not provided, uses env var or keeps existing
				enabledModels: z.array(z.string()).optional(),
				baseUrl: z.string().url().optional().or(z.literal('')),
			}),
		)
		.output(llmConfigSchema.omit({ createdAt: true, updatedAt: true }))
		.mutation(async ({ ctx, input }) => {
			const existingConfig = await llmConfigQueries.getProjectLlmConfigByProvider(ctx.project.id, input.provider);
			const envApiKey = getEnvApiKey(input.provider);

			// Determine the API key to use:
			// 1. If apiKey provided in input, use it
			// 2. If editing existing config and no new key, keep existing (pass null to skip update)
			// 3. If new config and no key, use env var
			let apiKey: string | null;

			if (input.apiKey) {
				// New key provided
				apiKey = input.apiKey;
			} else if (existingConfig) {
				// Editing - keep existing key (null signals "don't update")
				apiKey = null;
			} else if (envApiKey && input.enabledModels && input.enabledModels.length > 0) {
				apiKey = envApiKey;
			} else {
				throw new Error(`API Key is required for ${input.provider} or select at least one model.`);
			}

			const config = await llmConfigQueries.upsertProjectLlmConfig({
				projectId: ctx.project.id,
				provider: input.provider,
				apiKey,
				enabledModels: input.enabledModels ?? [],
				baseUrl: input.baseUrl || null,
			} as Parameters<typeof llmConfigQueries.upsertProjectLlmConfig>[0]);

			return {
				id: config.id,
				provider: config.provider as LlmProvider,
				apiKeyPreview: config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4),
				enabledModels: config.enabledModels ?? [],
				baseUrl: config.baseUrl ?? null,
			};
		}),

	deleteLlmConfig: adminProtectedProcedure
		.input(z.object({ provider: llmProviderSchema }))
		.output(z.object({ success: z.boolean() }))
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

	getAllUsersWithRoles: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return [];
		}
		return projectQueries.getAllUsersWithRoles(ctx.project.id);
	}),

	getKnownModels: publicProcedure.query(() => {
		return KNOWN_MODELS;
	}),
};
