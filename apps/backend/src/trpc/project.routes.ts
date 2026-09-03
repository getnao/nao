import { BACKGROUND_MODEL_CATEGORIES, type CustomBoundarySet } from '@nao/shared';
import { DATE_FORMAT_PRESETS } from '@nao/shared/date';
import {
	type LlmProvider,
	MAX_PYTHON_EXECUTION_DURATION_SECS,
	MIN_PYTHON_EXECUTION_DURATION_SECS,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { getProviderAuth, KNOWN_MODELS } from '../agents/providers';
import { getDatabaseObjects } from '../agents/user-rules';
import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as crQueries from '../queries/context-recommendation.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as mattermostConfigQueries from '../queries/project-mattermost-config.queries';
import * as savedPromptQueries from '../queries/project-saved-prompt.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import * as teamsConfigQueries from '../queries/project-teams-config.queries';
import * as telegramConfigQueries from '../queries/project-telegram-config.queries';
import * as whatsappConfigQueries from '../queries/project-whatsapp-config.queries';
import * as projectWhatsappLinkQueries from '../queries/project-whatsapp-link.queries';
import * as userQueries from '../queries/user.queries';
import { cleanupContextWorktree } from '../services/context-explorer-git.service';
import { mattermostService } from '../services/mattermost';
import { MattermostConnectionError, validateMattermostConnection } from '../services/mattermost-helpers';
import { posthog, PostHogEvent } from '../services/posthog';
import { slackService } from '../services/slack';
import { listAvailableTranscribeModels as getAvailableTranscribeModels } from '../services/transcribe.service';
import { AgentSettings } from '../types/agent-settings';
import type { ContextUsage } from '../types/chat';
import {
	configLlmProviderSchema,
	customModelMetadataSchema,
	llmConfigSchema,
	llmProviderSchema,
	modelSettingsMapSchema,
} from '../types/llm';
import { getChatContextUsage } from '../utils/chat-context-usage';
import { isValidIsoDateString } from '../utils/date';
import {
	getEnvApiKey,
	getEnvBaseUrls,
	getEnvProviders,
	getProjectAvailableModels,
	getProjectConfigLlm,
} from '../utils/llm';
import { extractRequiredEnvVars } from '../utils/nao-config';
import { findConfigLlmProvider } from '../utils/nao-config-llm';
import { parseAndValidateGeoJson, safeFetch } from '../utils/safe-fetch';
import { buildCredentialPreviews, previewApiKey } from '../utils/utils';
import {
	adminProtectedProcedure,
	contextAdminProtectedProcedure,
	projectProtectedProcedure,
	protectedProcedure,
	publicProcedure,
} from './trpc';

const isoDateString = z.string().refine(isValidIsoDateString, {
	message: 'Must be a valid YYYY-MM-DD date',
});

const backgroundModelSelectionSchema = z.object({
	provider: llmProviderSchema,
	modelId: z.string().min(1),
});

const backgroundModelCategoriesSchema = z.object(
	Object.fromEntries(
		BACKGROUND_MODEL_CATEGORIES.map((category) => [category, backgroundModelSelectionSchema.optional()]),
	) as Record<(typeof BACKGROUND_MODEL_CATEGORIES)[number], z.ZodOptional<typeof backgroundModelSelectionSchema>>,
);

const backgroundModelSettingsSchema = z.object({
	mode: z.enum(['single', 'perCategory']),
	single: backgroundModelSelectionSchema.optional(),
	categories: backgroundModelCategoriesSchema.optional(),
});

const httpUrlSchema = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
	message: 'Enter a valid HTTP or HTTPS URL',
});

async function validateBoundarySource(url: string): Promise<number> {
	try {
		const text = await safeFetch(url);
		return parseAndValidateGeoJson(text).featureCount;
	} catch (error) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Could not load boundaries from URL: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

export const projectRoutes = {
	listForCurrentUser: protectedProcedure.query(async ({ ctx }) => {
		const projects = await projectQueries.listUserProjectsWithRoles(ctx.user.id);
		return projects.map(({ project, userRole }) => ({
			id: project.id,
			orgId: project.orgId,
			name: project.name,
			type: project.type,
			path: project.path,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt,
			userRole,
		}));
	}),

	getCurrent: protectedProcedure.query(async ({ ctx }) => {
		const project = await projectQueries.getProjectByUserId(ctx.user.id, ctx.selectedProjectId);
		if (!project) {
			return null;
		}
		const userRole = await projectQueries.getUserRoleInProject(project.id, ctx.user.id);
		return { id: project.id, name: project.name, path: project.path, userRole };
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
				configProviders: z.array(configLlmProviderSchema),
				envProviders: z.array(llmProviderSchema),
				envBaseUrls: z.record(z.string(), z.string()),
			}),
		)
		.query(async ({ ctx }) => {
			if (!ctx.project) {
				return { projectConfigs: [], configProviders: [], envProviders: [], envBaseUrls: {} };
			}

			const configs = await llmConfigQueries.getProjectLlmConfigs(ctx.project.id);

			const projectConfigs = configs.map((c) => ({
				id: c.id,
				provider: c.provider as LlmProvider,
				apiKeyPreview: previewApiKey(c.apiKey),
				credentialPreviews: buildCredentialPreviews(c.credentials),
				enabledModels: c.enabledModels ?? [],
				customModels: c.customModels ?? [],
				modelSettings: c.modelSettings ?? {},
				baseUrl: c.baseUrl ?? null,
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			}));

			const configLlm = await getProjectConfigLlm(ctx.project.id);
			const configProviders = (configLlm?.providers ?? []).map((p) => ({
				provider: p.provider,
				apiKeyPreview: previewApiKey(p.apiKey),
				credentialPreviews: buildCredentialPreviews(p.credentials),
				enabledModels: p.enabledModels,
				customModels: p.customModels,
				modelSettings: p.modelSettings,
				baseUrl: p.baseUrl,
			}));

			// nao chat also exports config credentials to the environment; show each provider once.
			const envProviders = getEnvProviders().filter(
				(provider) => !configProviders.some((p) => p.provider === provider),
			);

			return { projectConfigs, configProviders, envProviders, envBaseUrls: getEnvBaseUrls() };
		}),

	/** Get all available models for the current project (for user model selection) */
	listAvailableTranscribeModels: projectProtectedProcedure
		.output(
			z.array(
				z.object({
					provider: llmProviderSchema,
					modelId: z.string(),
					name: z.string(),
					baseUrl: z.string().nullable(),
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
				customModels: z.array(customModelMetadataSchema).optional(),
				modelSettings: modelSettingsMapSchema.optional(),
				baseUrl: z.string().url().optional().or(z.literal('')),
			}),
		)
		.output(llmConfigSchema.omit({ createdAt: true, updatedAt: true }))
		.mutation(async ({ ctx, input }) => {
			const existingConfig = await llmConfigQueries.getProjectLlmConfigByProvider(ctx.project.id, input.provider);
			const inheritedConfig = existingConfig
				? null
				: findConfigLlmProvider(await getProjectConfigLlm(ctx.project.id), input.provider);
			const envApiKey = getEnvApiKey(input.provider);

			const hasNewCredentials = Object.values(input.credentials ?? {}).some(Boolean);
			const credentials = hasNewCredentials
				? {
						...(existingConfig?.credentials ?? inheritedConfig?.credentials),
						...input.credentials,
					}
				: (inheritedConfig?.credentials ?? undefined);

			let apiKey: string | null;

			if (input.apiKey) {
				apiKey = input.apiKey;
			} else if (hasNewCredentials) {
				apiKey = '';
			} else if (existingConfig) {
				apiKey = null;
			} else if (inheritedConfig?.apiKey) {
				apiKey = inheritedConfig.apiKey;
			} else if (envApiKey) {
				apiKey = envApiKey;
			} else if (getProviderAuth(input.provider).apiKey !== 'required') {
				apiKey = '';
			} else {
				throw new Error(
					`API key is required for ${input.provider}. Provide one or set it as an environment variable.`,
				);
			}

			const enabledModels = input.enabledModels ?? [];
			const customModels = (input.customModels ?? []).filter((m) => enabledModels.includes(m.id));
			const modelSettings = input.modelSettings
				? Object.fromEntries(
						Object.entries(input.modelSettings).filter(([modelId]) => enabledModels.includes(modelId)),
					)
				: undefined;

			const config = await llmConfigQueries.upsertProjectLlmConfig({
				projectId: ctx.project.id,
				provider: input.provider,
				apiKey,
				credentials,
				enabledModels,
				customModels,
				modelSettings,
				baseUrl: input.baseUrl || null,
			} as Parameters<typeof llmConfigQueries.upsertProjectLlmConfig>[0]);

			return {
				id: config.id,
				provider: config.provider as LlmProvider,
				apiKeyPreview: previewApiKey(config.apiKey),
				credentialPreviews: buildCredentialPreviews(config.credentials),
				enabledModels: config.enabledModels ?? [],
				customModels: config.customModels ?? [],
				modelSettings: config.modelSettings ?? {},
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
					signingSecretPreview: config.signingSecret
						? config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4)
						: '',
					appTokenPreview: config.appToken
						? config.appToken.slice(0, 4) + '...' + config.appToken.slice(-4)
						: '',
					transportMode: config.transportMode,
					modelSelection: config.modelSelection,
					autoCreateUsersEnabled: config.autoCreateUsersEnabled,
					autoCreateUsersDomains: config.autoCreateUsersDomains,
					replyMode: config.replyMode,
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
			z
				.object({
					botToken: z.string().min(1),
					signingSecret: z.string().default(''),
					appToken: z.string().default(''),
					transportMode: z.enum(['webhook', 'socket']).default('webhook'),
					modelProvider: llmProviderSchema.optional(),
					modelId: z.string().optional(),
				})
				.refine(
					(value) =>
						value.transportMode === 'socket' ? value.appToken.length > 0 : value.signingSecret.length > 0,
					{
						message:
							'Webhook mode requires a signing secret; Socket Mode requires an app-level token (xapp-...).',
					},
				),
		)
		.mutation(async ({ ctx, input }) => {
			const config = await slackConfigQueries.upsertProjectSlackConfig({
				projectId: ctx.project.id,
				botToken: input.botToken,
				signingSecret: input.signingSecret,
				appToken: input.appToken,
				transportMode: input.transportMode,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
			});

			posthog.capture(ctx.user.id, PostHogEvent.SlackConfigured, {
				project_id: ctx.project.id,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
				transport_mode: input.transportMode,
			});

			const refreshedConfig = await slackConfigQueries.getProjectSlackConfig(ctx.project.id);
			await slackService.syncProjectSocketMode(refreshedConfig, ctx.project.id);

			return {
				botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
				signingSecretPreview: config.signingSecret
					? config.signingSecret.slice(0, 4) + '...' + config.signingSecret.slice(-4)
					: '',
				appTokenPreview: config.appToken ? config.appToken.slice(0, 4) + '...' + config.appToken.slice(-4) : '',
				transportMode: config.transportMode,
				modelSelection: config.modelSelection,
				replyMode: config.replyMode,
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
			const refreshedConfig = await slackConfigQueries.getProjectSlackConfig(ctx.project.id);
			await slackService.syncProjectSocketMode(refreshedConfig, ctx.project.id);
		}),

	updateSlackReplyMode: adminProtectedProcedure
		.input(z.object({ replyMode: z.enum(['thread', 'mention']) }))
		.mutation(async ({ ctx, input }) => {
			await slackConfigQueries.updateProjectSlackReplyMode(ctx.project.id, input.replyMode);
			const refreshedConfig = await slackConfigQueries.getProjectSlackConfig(ctx.project.id);
			await slackService.syncProjectSocketMode(refreshedConfig, ctx.project.id);
			return { replyMode: input.replyMode };
		}),

	updateSlackAutoCreateUsers: adminProtectedProcedure
		.input(
			z.object({
				enabled: z.boolean(),
				domains: z.array(z.string().trim().toLowerCase()).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const cleanedDomains = [...new Set(input.domains.map((d) => d.trim()).filter((d) => d.length > 0))];
			if (input.enabled && cleanedDomains.length === 0) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'At least one allowed domain is required to auto-create users from Slack.',
				});
			}
			await slackConfigQueries.updateProjectSlackAutoCreateUsers(ctx.project.id, input.enabled, cleanedDomains);
			const refreshedConfig = await slackConfigQueries.getProjectSlackConfig(ctx.project.id);
			await slackService.syncProjectSocketMode(refreshedConfig, ctx.project.id);
			return { enabled: input.enabled, domains: cleanedDomains };
		}),

	deleteSlackConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await slackConfigQueries.deleteProjectSlackConfig(ctx.project.id);
		await slackService.stopProject(ctx.project.id);
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

	getMattermostConfig: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { projectConfig: null, projectId: '', connected: false };
		}

		const config = await mattermostConfigQueries.getProjectMattermostConfig(ctx.project.id);
		const projectConfig = config
			? {
					baseUrl: config.baseUrl,
					botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
					modelSelection: config.modelSelection,
					interactiveButtonsEnabled: config.interactiveButtonsEnabled,
					callbackUrl: config.callbackUrl ?? '',
				}
			: null;

		return {
			projectConfig,
			projectId: ctx.project.id,
			connected: mattermostService.getAdapter(ctx.project.id) !== null,
		};
	}),

	upsertMattermostConfig: adminProtectedProcedure
		.input(
			z.object({
				baseUrl: httpUrlSchema,
				botToken: z.string().min(1),
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
				interactiveButtonsEnabled: z.boolean().default(false),
				callbackUrl: z.union([z.literal(''), httpUrlSchema]).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				await validateMattermostConnection({
					baseUrl: input.baseUrl,
					botToken: input.botToken,
				});
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						error instanceof MattermostConnectionError
							? error.message
							: 'Could not verify the Mattermost connection. Try again.',
				});
			}

			const config = await mattermostConfigQueries.upsertProjectMattermostConfig({
				projectId: ctx.project.id,
				baseUrl: input.baseUrl,
				botToken: input.botToken,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
				interactiveButtonsEnabled: input.interactiveButtonsEnabled,
				callbackUrl: input.callbackUrl,
			});
			try {
				await mattermostService.syncProject(config, ctx.project.id);
			} catch {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Mattermost connected, but the bot could not start. Try again.',
				});
			}

			posthog.capture(ctx.user.id, PostHogEvent.MattermostConfigured, {
				project_id: ctx.project.id,
				modelProvider: input.modelProvider,
				modelId: input.modelId,
				interactive_buttons_enabled: input.interactiveButtonsEnabled,
			});

			return {
				baseUrl: config.baseUrl,
				botTokenPreview: config.botToken.slice(0, 4) + '...' + config.botToken.slice(-4),
				modelSelection: config.modelSelection,
				interactiveButtonsEnabled: config.interactiveButtonsEnabled,
				callbackUrl: config.callbackUrl ?? '',
			};
		}),

	updateMattermostModelConfig: adminProtectedProcedure
		.input(
			z.object({
				modelProvider: llmProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await mattermostConfigQueries.updateProjectMattermostModel(
				ctx.project.id,
				input.modelProvider ?? null,
				input.modelId ?? null,
			);
			const refreshedConfig = await mattermostConfigQueries.getProjectMattermostConfig(ctx.project.id);
			await mattermostService.syncProject(refreshedConfig, ctx.project.id);
		}),

	deleteMattermostConfig: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await mattermostConfigQueries.deleteProjectMattermostConfig(ctx.project.id);
		await mattermostService.stopProject(ctx.project.id);
		return { success: true };
	}),

	regenerateMessagingProviderCode: adminProtectedProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const members = await projectQueries.listProjectMembersWithRoles(ctx.project.id);
			const isMember = members.some((m) => m.id === input.userId);
			if (!isMember) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'User is not a member of this project' });
			}
			return await userQueries.regenerateMessagingProviderCode(input.userId);
		}),

	getCurrentUserMessagingProviderCode: projectProtectedProcedure.query(async ({ ctx }) => {
		const user = await userQueries.getUser({ id: ctx.user.id });
		if (!user) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
		}
		return user.messagingProviderCode;
	}),

	regenerateCurrentUserMessagingProviderCode: projectProtectedProcedure.mutation(async ({ ctx }) => {
		return await userQueries.regenerateMessagingProviderCode(ctx.user.id);
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

	getCurrentUserWhatsappLinks: projectProtectedProcedure.query(async ({ ctx }) => {
		return await projectWhatsappLinkQueries.listLinkedWhatsappUsersByUserId(ctx.project.id, ctx.user.id);
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

	unlinkCurrentUserWhatsappLink: projectProtectedProcedure
		.input(
			z.object({
				whatsappUserId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await projectWhatsappLinkQueries.deleteLinkedWhatsappUserByUserId(
				ctx.project.id,
				ctx.user.id,
				input.whatsappUserId,
			);
			return { success: true };
		}),

	listAllUsersWithRoles: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return [];
		}
		return projectQueries.listProjectMembersWithRoles(ctx.project.id);
	}),

	listUsersWithAccess: projectProtectedProcedure.query(async ({ ctx }) => {
		return projectQueries.listUsersWithProjectAccess(ctx.project.id);
	}),

	getProjectMembersByChatId: protectedProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ ctx, input }) => {
			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (!projectId) {
				return [];
			}
			const role = await projectQueries.getUserRoleInProject(projectId, ctx.user.id);
			if (!role) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
			}
			return projectQueries.listUsersWithProjectAccess(projectId);
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
			const remainingRole = await projectQueries.getUserRoleInProject(ctx.project.id, input.userId);
			if (ctx.project.path && remainingRole !== 'admin' && remainingRole !== 'context_admin') {
				await cleanupContextWorktree(ctx.project.id, ctx.project.path, input.userId);
			}
		}),

	getSavedPrompts: projectProtectedProcedure.query(async ({ ctx }) => {
		return savedPromptQueries.listSavedPrompts(ctx.project.id);
	}),

	createSavedPrompt: adminProtectedProcedure
		.input(
			z.object({
				title: z.string().trim().min(1).max(255),
				prompt: z.string().trim().min(1).max(10_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const saved = await savedPromptQueries.createSavedPrompt({
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
			const updated = await savedPromptQueries.updateSavedPrompt(ctx.project.id, promptId, data);
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
			await savedPromptQueries.deleteSavedPrompt(ctx.project.id, input.promptId);
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
				mapEnabled: z.boolean().optional(),
				transcribe: z
					.object({
						enabled: z.boolean().optional(),
						provider: z.string().optional(),
						modelId: z.string().optional(),
					})
					.optional(),
				sql: z
					.object({
						dangerouslyWritePermEnabled: z.boolean().optional(),
						enforceExcludedColumns: z.boolean().optional(),
					})
					.optional(),
				pythonExecution: z
					.object({
						maxDurationSecs: z
							.number()
							.int()
							.min(MIN_PYTHON_EXECUTION_DURATION_SECS)
							.max(MAX_PYTHON_EXECUTION_DURATION_SECS)
							.optional(),
					})
					.optional(),
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
				mapEnabled: input.mapEnabled ?? existing.mapEnabled,
				experimental: { ...existing.experimental, ...input.experimental },
				transcribe: { ...existing.transcribe, ...input.transcribe },
				sql: { ...existing.sql, ...input.sql },
				pythonExecution: { ...existing.pythonExecution, ...input.pythonExecution },
				webSearch: { ...existing.webSearch, ...input.webSearch },
			};
			posthog.capture(ctx.user.id, PostHogEvent.ProjectAgentSettingsUpdated, {
				project_id: ctx.project.id,
				transcribe_enabled: merged.transcribe?.enabled,
				transcribe_provider: merged.transcribe?.provider,
				transcribe_model_id: merged.transcribe?.modelId,
				sql_dangerously_write_perm_enabled: merged.sql?.dangerouslyWritePermEnabled,
				sql_enforce_excluded_columns: merged.sql?.enforceExcludedColumns,
				python_execution_max_duration_secs: merged.pythonExecution?.maxDurationSecs,
				python_sandboxing_enabled: merged.experimental?.pythonSandboxing,
				map_enabled: merged.mapEnabled,
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

	getDisplaySettings: projectProtectedProcedure.query(({ ctx }) => projectQueries.getDisplaySettings(ctx.project.id)),

	updateDisplaySettings: adminProtectedProcedure
		.input(
			z.object({
				dateFormat: z
					.object({
						preset: z.enum(DATE_FORMAT_PRESETS),
						customFormat: z.string().trim().max(64).optional(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const next = await projectQueries.updateDisplaySettings(ctx.project.id, input);
			posthog.capture(ctx.user.id, PostHogEvent.ProjectDisplaySettingsUpdated, {
				project_id: ctx.project.id,
				date_format_preset: next.dateFormat?.preset,
				date_format_has_custom_pattern: Boolean(next.dateFormat?.customFormat),
			});
			return next;
		}),

	getDefaultModels: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project) {
			return { settings: null, availableModels: [] };
		}
		const [settings, availableModels] = await Promise.all([
			projectQueries.getDefaultModelSettings(ctx.project.id),
			getProjectAvailableModels(ctx.project.id),
		]);
		return { settings, availableModels };
	}),

	updateDefaultModels: adminProtectedProcedure
		.input(backgroundModelSettingsSchema)
		.mutation(({ ctx, input }) => projectQueries.updateDefaultModelSettings(ctx.project.id, input)),

	getProjectChats: contextAdminProtectedProcedure
		.input(
			z.object({
				page: z.number().int().min(0).default(0),
				pageSize: z.number().int().min(1).max(100).default(30),
				search: z.string().trim().optional(),
				filters: z
					.array(
						z.object({
							id: z.enum(['userName', 'userRole', 'toolState', 'feedback', 'source']),
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

	getChatReplay: contextAdminProtectedProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ ctx, input }) => {
			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (!projectId || projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}

			const [chat, ownerId] = await chatQueries.getChat(input.chatId, { includeFeedback: true });
			if (!chat) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}

			const ownerName = ownerId ? await userQueries.getUserName(ownerId) : null;

			const downvotedMessageIds = (chat.messages ?? [])
				.filter((m) => m.feedback?.vote === 'down')
				.map((m) => m.id);
			const recLinks = await crQueries.getRecommendationLinksForMessages(ctx.project.id, downvotedMessageIds);
			const feedbackRecommendations: Record<
				string,
				{ id: string; title: string; status: (typeof recLinks)[number]['status'] }
			> = {};
			for (const link of recLinks) {
				feedbackRecommendations[link.messageId] ??= {
					id: link.recommendationId,
					title: link.title,
					status: link.status,
				};
			}

			return {
				...chat,
				ownerId: ownerId ?? null,
				ownerName,
				chatOwnerId: ownerId ?? null,
				feedbackRecommendations,
			};
		}),

	getChatReplayContextUsage: contextAdminProtectedProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ ctx, input }): Promise<ContextUsage> => {
			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (!projectId || projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}

			const ownerId = await chatQueries.getChatOwnerId(input.chatId);
			const model = await chatQueries.getLatestAssistantModel(input.chatId);
			const usage = await getChatContextUsage({
				chatId: input.chatId,
				userId: ownerId ?? ctx.user.id,
				model: model ?? undefined,
				projectId,
			});

			if (!usage) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}

			return usage;
		}),

	getEnvVars: adminProtectedProcedure.query(async ({ ctx }) => {
		const requiredVars = ctx.project.path ? extractRequiredEnvVars(ctx.project.path) : [];
		const storedVars = await projectQueries.getEnvVars(ctx.project.id);
		return {
			required: requiredVars,
			values: storedVars,
		};
	}),

	updateEnvVars: adminProtectedProcedure
		.input(z.object({ envVars: z.record(z.string(), z.string()) }))
		.mutation(async ({ ctx, input }) => {
			await projectQueries.updateEnvVars(ctx.project.id, input.envVars);
		}),

	getMapBoundaries: projectProtectedProcedure.query(async ({ ctx }) => {
		return projectQueries.getCustomBoundaries(ctx.project.id);
	}),

	validateMapBoundaryUrl: adminProtectedProcedure
		.input(z.object({ url: z.url() }))
		.mutation(async ({ ctx: _ctx, input }) => {
			const text = await safeFetch(input.url);
			const { geojson, propertyKeys, featureCount } = parseAndValidateGeoJson(text);
			return { propertyKeys, featureCount, geojson };
		}),

	addMapBoundary: adminProtectedProcedure
		.input(
			z.object({
				key: z
					.string()
					.trim()
					.min(1)
					.max(64)
					.regex(/^[a-z0-9_]+$/, 'Key must be lowercase letters, digits, or underscores only.'),
				label: z.string().trim().min(1).max(255),
				url: z.url(),
				joinProperty: z.string().trim().min(1).max(255),
				regionKeyHint: z.string().trim().min(1).max(500),
				featureCount: z.number().int().nonnegative().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const featureCount = await validateBoundarySource(input.url);
			return projectQueries.addCustomBoundary(ctx.project.id, {
				key: input.key,
				label: input.label,
				url: input.url,
				joinProperty: input.joinProperty,
				regionKeyHint: input.regionKeyHint,
				featureCount,
			});
		}),

	updateMapBoundary: adminProtectedProcedure
		.input(
			z.object({
				key: z.string().trim().min(1),
				newKey: z
					.string()
					.trim()
					.min(1)
					.max(64)
					.regex(/^[a-z0-9_]+$/)
					.optional(),
				label: z.string().trim().min(1).max(255).optional(),
				url: z.url().optional(),
				joinProperty: z.string().trim().min(1).max(255).optional(),
				regionKeyHint: z.string().trim().min(1).max(500).optional(),
				featureCount: z.number().int().nonnegative().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const patch: Partial<CustomBoundarySet> = {};
			if (input.newKey) {
				patch.key = input.newKey;
			}
			if (input.label !== undefined) {
				patch.label = input.label;
			}
			if (input.joinProperty !== undefined) {
				patch.joinProperty = input.joinProperty;
			}
			if (input.regionKeyHint !== undefined) {
				patch.regionKeyHint = input.regionKeyHint;
			}
			if (input.url !== undefined) {
				patch.url = input.url;
				patch.featureCount = await validateBoundarySource(input.url);
			}
			return projectQueries.updateCustomBoundary(ctx.project.id, input.key, patch);
		}),

	deleteMapBoundary: adminProtectedProcedure
		.input(z.object({ key: z.string().trim().min(1) }))
		.mutation(async ({ ctx, input }) => {
			return projectQueries.deleteCustomBoundary(ctx.project.id, input.key);
		}),
};
