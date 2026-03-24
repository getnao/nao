import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { getProviderAuth, KNOWN_MODELS } from '../agents/providers';
import { getDatabaseObjects } from '../agents/user-rules';
import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as savedPromptQueries from '../queries/project-saved-prompt.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import * as teamsConfigQueries from '../queries/project-teams-config.queries';
import * as telegramConfigQueries from '../queries/project-telegram-config.queries';
import * as whatsappConfigQueries from '../queries/project-whatsapp-config.queries';
import * as userQueries from '../queries/user.queries';
import { posthog, PostHogEvent } from '../services/posthog';
import { getAvailableModels as getAvailableTranscribeModels } from '../services/transcribe.service';
import { AgentSettings } from '../types/agent-settings';
import { llmConfigSchema, LlmProvider, llmProviderSchema } from '../types/llm';
import { isValidIsoDateString } from '../utils/date';
import { getEnvApiKey, getEnvBaseUrls, getEnvProviders, getProjectAvailableModels } from '../utils/llm';
import { buildCredentialPreviews } from '../utils/utils';
import { adminProtectedProcedure, projectProtectedProcedure, publicProcedure } from './trpc';

const isoDateString = z.string().refine(isValidIsoDateString, {
	message: 'Must be a valid YYYY-MM-DD date',
});

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

	getDatabaseObjects: projectProtectedProcedure
		.output(
			z.array(
				z.object({
					type: z.string(),
					database: z.string(),
					schema: z.string(),
					table: z.string(),
					fqdn: z.string(),
				}),
			),
		)
		.query(({ ctx }) => {
			if (!ctx.project?.path) {
				return [];
			}
			return getDatabaseObjects(ctx.project.path);
		}),

	getLlmConfigs: projectProtectedProcedure
		.output(
			z.object({
				projectConfigs: z.array(llmConfigSchema),
				envProviders: z.array(llmProviderSchema),
				envBaseUrls: z.record(z.string(), z.string()),
			}),
		)
		.query(async ({ ctx }) => {
			if (!ctx.project) {
				return { projectConfigs: [], envProviders: [], envBaseUrls: {} };
			}

			const configs = await llmConfigQueries.getProjectLlmConfigs(ctx.project.id);

			const projectConfigs = configs.map((c) => ({
				id: c.id,
				provider: c.provider as LlmProvider,
				apiKeyPreview: c.apiKey ? c.apiKey.slice(0, 8) + '...' + c.apiKey.slice(-4) : null,
				credentialPreviews: buildCredentialPreviews(c.credentials),
				enabledModels: c.enabledModels ?? [],
				baseUrl: c.baseUrl ?? null,
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			}));

			const envProviders = getEnvProviders();
			const envBaseUrls = getEnvBaseUrls();

			return { projectConfigs, envProviders, envBaseUrls };
		}),

	/** Get all available models for the current project (for user model selection) */
	getAvailableModels: projectProtectedProcedure
		.output(
			z.array(
				z.object({
					provider: llmProviderSchema,
					modelId: z.string(),
					name: z.string(),
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
				apiKey: z.string().min(1).optional(),
				credentials: z.record(z.string(), z.string()).optional(),
				enabledModels: z.array(z.string()).optional(),
				baseUrl: z.string().url().optional().or(z.literal('')),
			}),
		)
		.output(llmConfigSchema.omit({ createdAt: true, updatedAt: true }))
		.mutation(async ({ ctx, input }) => {
			const existingConfig = await llmConfigQueries.getProjectLlmConfigByProvider(ctx.project.id, input.provider);
			const envApiKey = getEnvApiKey(input.provider);

			const hasNewCredentials =
				input.credentials && Object.keys(input.credentials).some((k) => input.credentials![k]);

			let apiKey: string | null;

			if (input.apiKey) {
				apiKey = input.apiKey;
			} else if (hasNewCredentials && !input.apiKey) {
				apiKey = '';
			} else if (existingConfig) {
				apiKey = null;
			} else if (envApiKey) {
				apiKey = envApiKey;
			} else if (getProviderAuth(input.provider).apiKey !== 'required') {
				apiKey = '';
			} else {
				throw new Error(
					`API key is required for ${input.provider}. Provide one or set it as an environment variable.`,
				);
			}

			const config = await llmConfigQueries.upsertProjectLlmConfig({
				projectId: ctx.project.id,
				provider: input.provider,
				apiKey,
				credentials: hasNewCredentials ? input.credentials! : undefined,
				enabledModels: input.enabledModels ?? [],
				baseUrl: input.baseUrl || null,
			} as Parameters<typeof llmConfigQueries.upsertProjectLlmConfig>[0]);

			return {
				id: config.id,
				provider: config.provider as LlmProvider,
				apiKeyPreview: config.apiKey ? config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4) : null,
				credentialPreviews: buildCredentialPreviews(config.credentials),
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
			return { projectConfig: null, webhookUrl: '' };
		}

		const config = await slackConfigQueries.getProjectSlackConfig(ctx.project.id);

		const projectConfig = config
			? {
					botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
					signingSecretPreview: config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4),
					modelSelection: config.modelSelection,
				}
			: null;

		const baseUrl = env.BETTER_AUTH_URL || 'http://localhost:3000';
		return {
			projectConfig,
			webhookUrl: `${baseUrl}/api/webhooks/slack/${ctx.project.id}`,
		};
	}),

	upsertSlackConfig: adminProtectedProcedure
		.input(
			z.object({
				botToken: z.string().min(1),
				signingSecret: z.string().min(1),
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await slackConfigQueries.upsertProjectSlackConfig({
				projectId: ctx.project.id,
				botToken: input.botToken,
				signingSecret: input.signingSecret,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			posthog.capture(ctx.user.id, PostHogEvent.SlackConfigured, {
				project_id: ctx.project.id,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			return {
				botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
				signingSecretPreview: config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4),
				modelSelection: config.modelSelection,
			};
		}),

	updateSlackModelConfig: adminProtectedProcedure
		.input(
			z.object({
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await slackConfigQueries.updateProjectSlackModel(
				ctx.project.id,
				input.modelProvider ?? null,
				input.modelId ?? null,
			);
		}),

	deleteSlackConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await slackConfigQueries.deleteProjectSlackConfig(ctx.project.id);
		return { success: true };
	}),

	getTeamsConfig: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { projectConfig: null, projectId: '' };
		}

		const config = await teamsConfigQueries.getProjectTeamsConfig(ctx.project.id);

		const projectConfig = config
			? {
					appIdPreview: config.appId.slice(0, 4) + '...' + config.appId.slice(-4),
					appPasswordPreview: config.appPassword.slice(0, 4) + '...' + config.appPassword.slice(-4),
					tenantIdPreview: config.tenantId.slice(0, 4) + '...' + config.tenantId.slice(-4),
					modelSelection: config.modelSelection,
				}
			: null;

		const baseUrl = env.BETTER_AUTH_URL || 'http://localhost:3000';
		return {
			projectConfig,
			projectId: ctx.project.id,
			redirectUrl: baseUrl,
			webhookUrl: `${baseUrl}/api/webhooks/teams/${ctx.project.id}`,
		};
	}),

	upsertTeamsConfig: adminProtectedProcedure
		.input(
			z.object({
				appId: z.string().min(1),
				appPassword: z.string().min(1),
				tenantId: z.string().min(1),
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await teamsConfigQueries.upsertProjectTeamsConfig({
				projectId: ctx.project.id,
				appId: input.appId,
				appPassword: input.appPassword,
				tenantId: input.tenantId,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			posthog.capture(ctx.user.id, PostHogEvent.TeamsConfigured, {
				project_id: ctx.project.id,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			return {
				appIdPreview: config.appId.slice(0, 4) + '...' + config.appId.slice(-4),
				appPasswordPreview: config.appPassword.slice(0, 4) + '...' + config.appPassword.slice(-4),
				tenantIdPreview: config.tenantId.slice(0, 4) + '...' + config.tenantId.slice(-4),
				modelSelection: config.modelSelection,
			};
		}),

	updateTeamsModelConfig: adminProtectedProcedure
		.input(
			z.object({
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await teamsConfigQueries.updateProjectTeamsModel(
				ctx.project.id,
				input.modelProvider ?? null,
				input.modelId ?? null,
			);
		}),

	deleteTeamsConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await teamsConfigQueries.deleteProjectTeamsConfig(ctx.project.id);
		return { success: true };
	}),

	getTelegramConfig: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { projectConfig: null, projectId: '' };
		}

		const config = await telegramConfigQueries.getProjectTelegramConfig(ctx.project.id);

		const projectConfig = config
			? {
					botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
					modelSelection: config.modelSelection,
				}
			: null;

		const baseUrl = env.BETTER_AUTH_URL || 'http://localhost:3000';
		return {
			projectConfig,
			projectId: ctx.project.id,
			webhookUrl: `${baseUrl}/api/webhooks/telegram/${ctx.project.id}`,
		};
	}),

	upsertTelegramConfig: adminProtectedProcedure
		.input(
			z.object({
				botToken: z.string().min(1),
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await telegramConfigQueries.upsertProjectTelegramConfig({
				projectId: ctx.project.id,
				botToken: input.botToken,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			posthog.capture(ctx.user.id, PostHogEvent.TelegramConfigured, {
				project_id: ctx.project.id,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			return {
				botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
				modelSelection: config.modelSelection,
			};
		}),

	updateTelegramModelConfig: adminProtectedProcedure
		.input(
			z.object({
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await telegramConfigQueries.updateProjectTelegramModel(
				ctx.project.id,
				input.modelProvider ?? null,
				input.modelId ?? null,
			);
		}),

	deleteTelegramConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await telegramConfigQueries.deleteProjectTelegramConfig(ctx.project.id);
		return { success: true };
	}),

	regenerateMessagingProviderCode: adminProtectedProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const members = await projectQueries.getAllUsersWithRoles(ctx.project.id);
			const isMember = members.some((m) => m.id === input.userId);
			if (!isMember) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'User is not a member of this project' });
			}
			return await userQueries.regenerateMessagingProviderCode(input.userId);
		}),

	getWhatsappConfig: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { projectConfig: null, projectId: '' };
		}

		const config = await whatsappConfigQueries.getProjectWhatsappConfig(ctx.project.id);

		const projectConfig = config
			? {
					accessTokenPreview: config.accessToken.slice(0, 4) + '...' + config.accessToken.slice(-4),
					appSecretPreview: config.appSecret.slice(0, 4) + '...' + config.appSecret.slice(-4),
					phoneNumberIdPreview: config.phoneNumberId.slice(0, 4) + '...' + config.phoneNumberId.slice(-4),
					verifyTokenPreview: config.verifyToken.slice(0, 4) + '...' + config.verifyToken.slice(-4),
					modelSelection: config.modelSelection,
				}
			: null;

		const baseUrl = env.BETTER_AUTH_URL || 'http://localhost:3000';
		return {
			projectConfig,
			projectId: ctx.project.id,
			webhookUrl: `${baseUrl}/api/webhooks/whatsapp/${ctx.project.id}`,
		};
	}),

	upsertWhatsappConfig: adminProtectedProcedure
		.input(
			z.object({
				accessToken: z.string().min(1),
				appSecret: z.string().min(1),
				phoneNumberId: z.string().min(1),
				verifyToken: z.string().min(1),
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await whatsappConfigQueries.upsertProjectWhatsappConfig({
				projectId: ctx.project.id,
				accessToken: input.accessToken,
				appSecret: input.appSecret,
				phoneNumberId: input.phoneNumberId,
				verifyToken: input.verifyToken,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			posthog.capture(ctx.user.id, PostHogEvent.WhatsappConfigured, {
				project_id: ctx.project.id,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			return {
				accessTokenPreview: config.accessToken.slice(0, 4) + '...' + config.accessToken.slice(-4),
				appSecretPreview: config.appSecret.slice(0, 4) + '...' + config.appSecret.slice(-4),
				phoneNumberIdPreview: config.phoneNumberId.slice(0, 4) + '...' + config.phoneNumberId.slice(-4),
				verifyTokenPreview: config.verifyToken.slice(0, 4) + '...' + config.verifyToken.slice(-4),
				modelSelection: config.modelSelection,
			};
		}),

	updateWhatsappModelConfig: adminProtectedProcedure
		.input(
			z.object({
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await whatsappConfigQueries.updateProjectWhatsappModel(
				ctx.project.id,
				input.modelProvider ?? null,
				input.modelId ?? null,
			);
		}),

	deleteWhatsappConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await whatsappConfigQueries.deleteProjectWhatsappConfig(ctx.project.id);
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

		const { isPythonAvailable, isSandboxAvailable } = await import('../agents/tools');
		const settings = await projectQueries.getAgentSettings(ctx.project.id);

		return {
			...settings,
			capabilities: {
				pythonSandbox: isPythonAvailable,
				sandbox: isSandboxAvailable,
			},
		};
	}),

	updateAgentSettings: adminProtectedProcedure
		.input(
			z.object({
				experimental: z
					.object({
						pythonSandboxing: z.boolean().optional(),
						sandboxes: z.boolean().optional(),
					})
					.optional(),
				transcribe: z
					.object({
						enabled: z.boolean().optional(),
						provider: z.string().optional(),
						modelId: z.string().optional(),
					})
					.optional(),
				sql: z.object({ dangerouslyWritePermEnabled: z.boolean().optional() }).optional(),
				memoryEnabled: z.boolean().optional(),
				webSearch: z
					.object({
						enabled: z.boolean().optional(),
						mode: z.enum(['provider']).optional(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = (await projectQueries.getAgentSettings(ctx.project.id)) ?? {};
			const merged: AgentSettings = {
				memoryEnabled: input.memoryEnabled ?? existing.memoryEnabled,
				experimental: { ...existing.experimental, ...input.experimental },
				transcribe: { ...existing.transcribe, ...input.transcribe },
				sql: { ...existing.sql, ...input.sql },
				webSearch: { ...existing.webSearch, ...input.webSearch },
			};
			posthog.capture(ctx.user.id, PostHogEvent.ProjectAgentSettingsUpdated, {
				project_id: ctx.project.id,
				transcribe_enabled: merged.transcribe?.enabled,
				transcribe_provider: merged.transcribe?.provider,
				transcribe_model_id: merged.transcribe?.modelId,
				sql_dangerously_write_perm_enabled: merged.sql?.dangerouslyWritePermEnabled,
				python_sandboxing_enabled: merged.experimental?.pythonSandboxing,
				memory_enabled: merged.memoryEnabled,
				web_search_enabled: merged.webSearch?.enabled,
				web_search_mode: merged.webSearch?.mode,
			});
			return projectQueries.updateAgentSettings(ctx.project.id, merged);
		}),

	getMemorySettings: projectProtectedProcedure.query(async ({ ctx }) => {
		const memoryEnabled = await projectQueries.getProjectMemoryEnabled(ctx.project.id);
		return { memoryEnabled };
	}),

	getProjectChats: adminProtectedProcedure
		.input(
			z.object({
				page: z.number().int().min(0).default(0),
				pageSize: z.number().int().min(1).max(100).default(30),
				search: z.string().trim().optional(),
				filters: z
					.array(
						z.object({
							id: z.enum(['userName', 'userRole', 'toolState']),
							values: z.array(z.string()).default([]),
						}),
					)
					.optional(),
				updatedAtFilter: z
					.union([
						z.object({ mode: z.literal('single'), value: isoDateString }),
						z.object({ mode: z.literal('range'), start: isoDateString, end: isoDateString }),
					])
					.optional(),
				sorting: z
					.array(
						z.object({
							id: z.string(),
							desc: z.boolean().optional(),
						}),
					)
					.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			return projectQueries.listProjectChats(ctx.project.id, input);
		}),

	getChatReplay: adminProtectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ ctx, input }) => {
		const projectId = await chatQueries.getChatProjectId(input.chatId);
		if (!projectId || projectId !== ctx.project.id) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
		}

		const [chat] = await chatQueries.loadChat(input.chatId, { includeFeedback: true });
		if (!chat) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
		}

		return chat;
	}),
};
