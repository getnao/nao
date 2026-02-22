import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { KNOWN_MODELS } from '../agents/providers';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as savedPromptQueries from '../queries/project-saved-prompt.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { posthog, PostHogEvent } from '../services/posthog.service';
import { getAvailableModels as getAvailableTranscribeModels } from '../services/transcribe.service';
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

		const hasEnvConfig = !!(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET);

		const projectConfig = config
			? {
					botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
					signingSecretPreview: config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4),
				}
			: null;

		const baseUrl = env.BETTER_AUTH_URL || '';
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

	getKnownTranscribeModels: projectProtectedProcedure.query(({ ctx }) => {
		return getAvailableTranscribeModels(ctx.project.id);
	}),

	removeProjectMember: adminProtectedProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const role = await projectQueries.getUserRoleInProject(ctx.project!.id, input.userId);
			if (role === 'admin') {
				throw new Error('Cannot remove an admin from the project.');
			}

			await projectQueries.removeProjectMember(ctx.project.id, input.userId);
		}),

	getSavedPrompts: projectProtectedProcedure.query(async ({ ctx }) => {
		return savedPromptQueries.getAll(ctx.project.id);
	}),

	createSavedPrompt: adminProtectedProcedure
		.input(
			z.object({
				title: z.string().trim().min(1).max(255),
				prompt: z.string().trim().min(1).max(10_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const saved = await savedPromptQueries.create({
				projectId: ctx.project.id,
				title: input.title,
				prompt: input.prompt,
			});
			posthog.capture(ctx.user.id, PostHogEvent.SavedPromptCreated, {
				project_id: ctx.project.id,
				saved_prompt_id: saved.id,
			});
			return saved;
		}),

	updateSavedPrompt: adminProtectedProcedure
		.input(
			z.object({
				id: z.string(),
				title: z.string().trim().min(1).max(255).optional(),
				prompt: z.string().trim().min(1).max(10_000).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { id: promptId, ...data } = input;
			const updated = await savedPromptQueries.update(ctx.project.id, promptId, data);
			if (!updated) {
				throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update saved prompt' });
			}
			posthog.capture(ctx.user.id, PostHogEvent.SavedPromptUpdated, {
				project_id: ctx.project.id,
				saved_prompt_id: promptId,
			});
			return updated;
		}),

	deleteSavedPrompt: adminProtectedProcedure
		.input(z.object({ promptId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await savedPromptQueries.remove(ctx.project.id, input.promptId);
			posthog.capture(ctx.user.id, PostHogEvent.SavedPromptDeleted, {
				project_id: ctx.project.id,
				saved_prompt_id: input.promptId,
			});
		}),

	getAgentSettings: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return null;
		}

		const { isPythonAvailable } = await import('../agents/tools');
		const settings = await projectQueries.getAgentSettings(ctx.project.id);

		return {
			...settings,
			capabilities: {
				pythonSandbox: isPythonAvailable,
			},
		};
	}),

	updateAgentSettings: adminProtectedProcedure
		.input(
			z.object({
				experimental: z
					.object({
						pythonSandboxing: z.boolean().optional(),
					})
					.optional(),
				transcribe: z
					.object({
						enabled: z.boolean().optional(),
						provider: z.string().optional(),
						modelId: z.string().optional(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = (await projectQueries.getAgentSettings(ctx.project.id)) ?? {};
			const merged = {
				experimental: { ...existing.experimental, ...input.experimental },
				transcribe: { ...existing.transcribe, ...input.transcribe },
			};
			return projectQueries.updateAgentSettings(ctx.project.id, merged);
		}),

	getMemorySettings: projectProtectedProcedure.query(async ({ ctx }) => {
		const memoryEnabled = await projectQueries.getProjectMemoryEnabled(ctx.project.id);
		return { memoryEnabled };
	}),

	updateMemorySettings: adminProtectedProcedure
		.input(z.object({ memoryEnabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await projectQueries.setProjectMemoryEnabled(ctx.project.id, input.memoryEnabled);
			return { memoryEnabled: input.memoryEnabled };
		}),
};
