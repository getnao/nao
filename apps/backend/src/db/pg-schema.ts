import type { McpChartEmbedStoredConfig } from '@nao/shared';
import type { CitationData, LlmProvider } from '@nao/shared/types';
import { BUDGET_PERIODS, FOLDER_SYSTEM_TYPE, FOLDER_VISIBILITY, SHARE_VISIBILITY, USER_ROLES } from '@nao/shared/types';
import { type ProviderMetadata } from 'ai';
import { sql } from 'drizzle-orm';
import {
	type AnyPgColumn,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from 'drizzle-orm/pg-core';

import { AgentSettings } from '../types/agent-settings';
import { AUTOMATION_RUN_STATUSES, AutomationIntegrationConfig, AutomationIntegrationResult } from '../types/automation';
import { ForkMetadata, MESSAGE_SOURCES, StopReason, ToolState, UIMessagePartType } from '../types/chat';
import {
	CONTEXT_RECOMMENDATION_FIX_KINDS,
	CONTEXT_RECOMMENDATION_FREQUENCIES,
	CONTEXT_RECOMMENDATION_RUN_STATUSES,
	CONTEXT_RECOMMENDATION_RUN_TRIGGERS,
	CONTEXT_RECOMMENDATION_SEVERITIES,
	CONTEXT_RECOMMENDATION_STATUSES,
	ProposedEdit,
	RecommendationImpact,
	RecommendationInsight,
} from '../types/context-recommendation';
import { LLM_INFERENCE_TYPES } from '../types/llm';
import { LOG_LEVELS, LOG_SOURCES } from '../types/log';
import { McpEndpointSettings } from '../types/mcp-endpoint';
import { MEMORY_CATEGORIES } from '../types/memory';
import { SlackSettings, TeamsSettings, TelegramSettings, WhatsappSettings } from '../types/messaging-provider';
import { ORG_ROLES } from '../types/organization';

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').default(false).notNull(),
	image: text('image'),
	requiresPasswordReset: boolean('requires_password_reset').default(false).notNull(),
	memoryEnabled: boolean('memory_enabled').default(true).notNull(),
	messagingProviderCode: text('messaging_provider_code').unique(),
	githubAccessToken: text('github_access_token'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at').notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organization = pgTable('organization', {
	id: text('id')
		.$defaultFn(() => crypto.randomUUID())
		.primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	// SSO config
	googleClientId: text('google_client_id'),
	googleClientSecret: text('google_client_secret'),
	googleAuthDomains: text('google_auth_domains'), // comma-separated list

	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const orgMember = pgTable(
	'org_member',
	{
		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ORG_ROLES }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('org_member_userId_idx').on(t.userId)],
);

export const project = pgTable(
	'project',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		orgId: text('org_id').references(() => organization.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		type: text('type', { enum: ['local'] }).notNull(),
		path: text('path'),
		agentSettings: jsonb('agent_settings').$type<AgentSettings>(),
		enabledMcpTools: jsonb('enabled_tools').$type<string[]>().notNull().default([]),
		knownMcpServers: jsonb('known_mcp_servers').$type<string[]>().notNull().default([]),

		envVars: jsonb('env_vars').$type<Record<string, string>>().notNull().default({}),

		slackSettings: jsonb('slack_settings').$type<SlackSettings>(),
		teamsSettings: jsonb('teams_settings').$type<TeamsSettings>(),
		telegramSettings: jsonb('telegram_settings').$type<TelegramSettings>(),
		whatsappSettings: jsonb('whatsapp_settings').$type<WhatsappSettings>(),
		mcpEndpointSettings: jsonb('mcp_endpoint_settings').$type<McpEndpointSettings>(),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		check('local_project_path_required', sql`CASE WHEN "type" = 'local' THEN "path" IS NOT NULL ELSE TRUE END`),
		index('project_orgId_idx').on(t.orgId),
	],
);

export const projectWhatsappLink = pgTable(
	'project_whatsapp_link',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		whatsappUserId: text('whatsapp_user_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.whatsappUserId] }),
		index('project_whatsapp_link_userId_idx').on(t.userId),
	],
);

export const chat = pgTable(
	'chat',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		title: text('title').notNull().default('New Conversation'),
		isStarred: boolean('is_starred').default(false).notNull(),
		deletedAt: timestamp('deleted_at'),
		slackThreadId: text('slack_thread_id'),
		teamsThreadId: text('teams_thread_id'),
		telegramThreadId: text('telegram_thread_id'),
		whatsappThreadId: text('whatsapp_thread_id'),
		forkMetadata: jsonb('fork_metadata').$type<ForkMetadata>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index('chat_userId_idx').on(table.userId),
		index('chat_projectId_idx').on(table.projectId),
		index('chat_slack_thread_idx').on(table.slackThreadId),
		index('chat_teams_thread_idx').on(table.teamsThreadId),
		index('chat_telegram_thread_idx').on(table.telegramThreadId),
		index('chat_whatsapp_thread_idx').on(table.whatsappThreadId),
	],
);

export const chatMessage = pgTable(
	'chat_message',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		chatId: text('chat_id')
			.notNull()
			.references(() => chat.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
		stopReason: text('stop_reason').$type<StopReason>(),
		errorMessage: text('error_message'),
		llmProvider: text('llm_provider').$type<LlmProvider>(),
		llmModelId: text('llm_model_id'),
		supersededAt: timestamp('superseded_at'),
		source: text('source', { enum: MESSAGE_SOURCES }),
		isForked: boolean('isForked'),
		citation: jsonb('citation').$type<CitationData>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),

		// Token usage columns
		inputTotalTokens: integer('input_total_tokens'),
		inputNoCacheTokens: integer('input_no_cache_tokens'),
		inputCacheReadTokens: integer('input_cache_read_tokens'),
		inputCacheWriteTokens: integer('input_cache_write_tokens'),
		outputTotalTokens: integer('output_total_tokens'),
		outputTextTokens: integer('output_text_tokens'),
		outputReasoningTokens: integer('output_reasoning_tokens'),
		totalTokens: integer('total_tokens'),
	},
	(table) => [
		index('chat_message_chatId_idx').on(table.chatId),
		index('chat_message_createdAt_idx').on(table.createdAt),
	],
);

export const messagePart = pgTable(
	'message_part',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		messageId: text('message_id')
			.references(() => chatMessage.id, { onDelete: 'cascade' })
			.notNull(),
		order: integer('order').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		type: text('type').$type<UIMessagePartType>().notNull(),

		// text columns
		text: text('text'),
		reasoningText: text('reasoning_text'),

		// tool call columns
		toolCallId: text('tool_call_id').unique(),
		toolName: text('tool_name'),
		toolState: text('tool_state').$type<ToolState>(),
		toolErrorText: text('tool_error_text'),
		toolInput: jsonb('tool_input').$type<unknown>(),
		toolRawInput: jsonb('tool_raw_input').$type<unknown>(),
		toolOutput: jsonb('tool_output').$type<unknown>(),

		// tool approval columns
		toolApprovalId: text('tool_approval_id'),
		toolApprovalApproved: boolean('tool_approval_approved'),
		toolApprovalReason: text('tool_approval_reason'),

		// provider metadata columns
		toolProviderMetadata: jsonb('tool_provider_metadata').$type<ProviderMetadata>(),
		providerMetadata: jsonb('provider_metadata').$type<ProviderMetadata>(),

		// file/image columns
		mediaType: text('media_type'),
		imageId: text('image_id').references(() => messageImage.id, { onDelete: 'set null' }),
	},
	(t) => [
		index('parts_message_id_idx').on(t.messageId),
		index('parts_message_id_order_idx').on(t.messageId, t.order),
		check(
			'text_required_if_type_is_text',
			sql`CASE WHEN ${t.type} = 'text' THEN ${t.text} IS NOT NULL ELSE TRUE END`,
		),
		check(
			'reasoning_text_required_if_type_is_reasoning',
			sql`CASE WHEN ${t.type} = 'reasoning' THEN ${t.reasoningText} IS NOT NULL ELSE TRUE END`,
		),
		check(
			'tool_call_fields_required',
			sql`CASE WHEN ${t.type} LIKE 'tool-%' THEN ${t.toolCallId} IS NOT NULL AND ${t.toolState} IS NOT NULL ELSE TRUE END`,
		),
		check(
			'file_fields_required',
			sql`CASE WHEN ${t.type} = 'file' THEN ${t.mediaType} IS NOT NULL AND ${t.imageId} IS NOT NULL ELSE TRUE END`,
		),
	],
);

export const messageFeedback = pgTable('message_feedback', {
	messageId: text('message_id')
		.primaryKey()
		.references(() => chatMessage.id, { onDelete: 'cascade' }),
	vote: text('vote', { enum: ['up', 'down'] }).notNull(),
	explanation: text('explanation'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const projectMember = pgTable(
	'project_member',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: USER_ROLES }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_member_userId_idx').on(t.userId)],
);

export const projectLlmConfig = pgTable(
	'project_llm_config',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		provider: text('provider').$type<LlmProvider>().notNull(),
		apiKey: text('api_key').notNull(),
		credentials: jsonb('credentials').$type<Record<string, string>>(),
		enabledModels: jsonb('enabled_models').$type<string[]>().default([]).notNull(),
		customModels: jsonb('custom_models')
			.$type<
				{
					id: string;
					displayName?: string;
					costPerM?: {
						inputNoCache?: number;
						inputCacheRead?: number;
						inputCacheWrite?: number;
						output?: number;
					};
				}[]
			>()
			.default([])
			.notNull(),
		baseUrl: text('base_url'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index('project_llm_config_projectId_idx').on(t.projectId),
		unique('project_llm_config_project_provider').on(t.projectId, t.provider),
	],
);

export const projectProviderBudget = pgTable(
	'project_provider_budget',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		provider: text('provider').$type<LlmProvider>().notNull(),
		limitUsd: integer('limit_usd').notNull(),
		period: text('period', { enum: BUDGET_PERIODS }).notNull(),
		currentPeriodStart: timestamp('current_period_start').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		notifiedAt: timestamp('notified_at'),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index('project_provider_budget_projectId_idx').on(t.projectId),
		unique('project_provider_budget_project_provider').on(t.projectId, t.provider),
		check('budget_period_valid', sql`${t.period} IN (${sql.raw(BUDGET_PERIODS.map((p) => `'${p}'`).join(', '))})`),
	],
);

export const sharedChat = pgTable(
	'shared_chat',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		chatId: text('chat_id')
			.notNull()
			.references(() => chat.id, { onDelete: 'cascade' }),
		visibility: text('visibility', { enum: SHARE_VISIBILITY }).default('project').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [unique('shared_chat_chatId_unique').on(t.chatId)],
);

export const sharedChatAccess = pgTable(
	'shared_chat_access',
	{
		sharedChatId: text('shared_chat_id')
			.notNull()
			.references(() => sharedChat.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(t) => [primaryKey({ columns: [t.sharedChatId, t.userId] })],
);

export const sharedStory = pgTable(
	'shared_story',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		storyId: text('story_id')
			.notNull()
			.references(() => story.id, { onDelete: 'cascade' }),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		visibility: text('visibility', { enum: SHARE_VISIBILITY }).default('project').notNull(),
		isPinned: boolean('is_pinned').default(false).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		index('shared_story_projectId_idx').on(t.projectId),
		index('shared_story_storyId_idx').on(t.storyId),
		uniqueIndex('shared_story_project_story_unique').on(t.projectId, t.storyId),
	],
);

export const sharedStoryAccess = pgTable(
	'shared_story_access',
	{
		sharedStoryId: text('shared_story_id')
			.notNull()
			.references(() => sharedStory.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(t) => [primaryKey({ columns: [t.sharedStoryId, t.userId] })],
);

export const projectSavedPrompt = pgTable(
	'project_saved_prompt',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		prompt: text('prompt').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index('project_saved_prompt_projectId_idx').on(t.projectId)],
);

export const automation = pgTable(
	'automation',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		scheduledJobId: text('scheduled_job_id').references(() => scheduledJob.id, { onDelete: 'set null' }),
		title: text('title').notNull(),
		prompt: text('prompt').notNull(),
		scheduleDescription: text('schedule_description'),
		timezone: text('timezone'),
		modelProvider: text('model_provider').$type<LlmProvider>(),
		modelId: text('model_id'),
		mcpEnabled: boolean('mcp_enabled').default(true).notNull(),
		mcpServers: jsonb('mcp_servers').$type<string[]>(),
		integrations: jsonb('integrations').$type<AutomationIntegrationConfig>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index('automation_projectId_idx').on(t.projectId),
		index('automation_userId_idx').on(t.userId),
		index('automation_scheduledJobId_idx').on(t.scheduledJobId),
	],
);

export const automationRun = pgTable(
	'automation_run',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		automationId: text('automation_id')
			.notNull()
			.references(() => automation.id, { onDelete: 'cascade' }),
		chatId: text('chat_id').references(() => chat.id, { onDelete: 'set null' }),
		status: text('status', { enum: AUTOMATION_RUN_STATUSES }).notNull().default('running'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		completedAt: timestamp('completed_at'),
		errorMessage: text('error_message'),
		integrationResults: jsonb('integration_results').$type<AutomationIntegrationResult[]>().notNull().default([]),
	},
	(t) => [
		index('automation_run_automationId_idx').on(t.automationId),
		index('automation_run_chatId_idx').on(t.chatId),
		index('automation_run_status_idx').on(t.status),
	],
);

export const contextRecommendationRun = pgTable(
	'context_recommendation_run',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		chatId: text('chat_id').references(() => chat.id, { onDelete: 'set null' }),
		trigger: text('trigger', { enum: CONTEXT_RECOMMENDATION_RUN_TRIGGERS }).notNull().default('schedule'),
		status: text('status', { enum: CONTEXT_RECOMMENDATION_RUN_STATUSES }).notNull().default('running'),
		windowStart: timestamp('window_start'),
		windowEnd: timestamp('window_end'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		completedAt: timestamp('completed_at'),
		errorMessage: text('error_message'),
		llmProvider: text('llm_provider').$type<LlmProvider>(),
		llmModelId: text('llm_model_id'),
		inputTotalTokens: integer('input_total_tokens'),
		outputTotalTokens: integer('output_total_tokens'),
		totalTokens: integer('total_tokens'),
	},
	(t) => [
		index('context_recommendation_run_projectId_idx').on(t.projectId),
		index('context_recommendation_run_chatId_idx').on(t.chatId),
		index('context_recommendation_run_status_idx').on(t.status),
		unique('context_recommendation_run_id_project_unique').on(t.id, t.projectId),
	],
);

export const contextRecommendationConfig = pgTable('context_recommendation_config', {
	projectId: text('project_id')
		.primaryKey()
		.references(() => project.id, { onDelete: 'cascade' }),
	modelProvider: text('model_provider').$type<LlmProvider>(),
	modelId: text('model_id'),
	frequency: text('frequency', { enum: CONTEXT_RECOMMENDATION_FREQUENCIES }),
	customSystemPromptInstructions: text('custom_system_prompt_instructions'),
	repoFullName: text('repo_full_name'),
	autoCreatePrs: boolean('auto_create_prs'),
	maxAutoPrsPerRun: integer('max_auto_prs_per_run'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const contextRecommendation = pgTable(
	'context_recommendation',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		runId: text('run_id').notNull(),
		fingerprint: text('fingerprint').notNull(),
		suggestedFile: text('suggested_file').notNull(),
		subjectKey: text('subject_key').notNull(),
		status: text('status', { enum: CONTEXT_RECOMMENDATION_STATUSES }).notNull().default('open'),
		snoozedUntil: timestamp('snoozed_until'),
		severity: text('severity', { enum: CONTEXT_RECOMMENDATION_SEVERITIES }).notNull().default('medium'),
		impactScore: integer('impact_score').notNull().default(0),
		impact: jsonb('impact').$type<RecommendationImpact>(),
		insights: jsonb('insights').$type<RecommendationInsight[]>().notNull().default([]),
		title: text('title').notNull(),
		summary: text('summary').notNull(),
		suggestedAction: text('suggested_action').notNull(),
		fixKind: text('fix_kind', { enum: CONTEXT_RECOMMENDATION_FIX_KINDS }),
		proposedEdits: jsonb('proposed_edits').$type<ProposedEdit[]>(),
		fixGuidance: text('fix_guidance'),
		fixPrompt: text('fix_prompt'),
		prUrl: text('pr_url'),
		prBranch: text('pr_branch'),
		prCreatedAt: timestamp('pr_created_at'),
		llmProvider: text('llm_provider').$type<LlmProvider>(),
		llmModelId: text('llm_model_id'),
		firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
		occurrenceCount: integer('occurrence_count').notNull().default(1),
		statusChangedAt: timestamp('status_changed_at'),
		statusChangedBy: text('status_changed_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex('context_recommendation_project_fingerprint_unique').on(t.projectId, t.fingerprint),
		index('context_recommendation_projectId_status_idx').on(t.projectId, t.status),
		index('context_recommendation_runId_idx').on(t.runId),
		// run_id is a soft link to the run that last touched this rec; recommendations
		// outlive runs, so a still-referenced run cannot be deleted (no cascade).
		foreignKey({
			columns: [t.runId, t.projectId],
			foreignColumns: [contextRecommendationRun.id, contextRecommendationRun.projectId],
			name: 'context_recommendation_run_fk',
		}),
	],
);

export const STORY_ACTIONS = ['create', 'update', 'replace'] as const;
export const STORY_SOURCES = ['assistant', 'user'] as const;

export const story = pgTable(
	'story',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		chatId: text('chat_id').references(() => chat.id, { onDelete: 'cascade' }),
		projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		slug: text('slug').notNull(),
		title: text('title').notNull(),
		isLive: boolean('is_live').default(false).notNull(),
		isLiveTextDynamic: boolean('is_live_text_dynamic').default(true).notNull(),
		cacheSchedule: text('cache_schedule'),
		cacheScheduleDescription: text('cache_schedule_description'),
		scheduledJobId: text('scheduled_job_id').references(() => scheduledJob.id, { onDelete: 'set null' }),
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		unique('story_chat_slug_unique').on(t.chatId, t.slug),
		uniqueIndex('story_standalone_slug_unique')
			.on(t.projectId, t.userId, t.slug)
			.where(sql`${t.chatId} IS NULL`),
		check(
			'story_owner_required',
			sql`${t.chatId} IS NOT NULL OR (${t.projectId} IS NOT NULL AND ${t.userId} IS NOT NULL)`,
		),
		index('story_chatId_idx').on(t.chatId),
		index('story_projectId_idx').on(t.projectId),
		index('story_userId_idx').on(t.userId),
		index('story_scheduledJobId_idx').on(t.scheduledJobId),
	],
);

export const storyVersion = pgTable(
	'story_version',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		storyId: text('story_id')
			.notNull()
			.references(() => story.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		code: text('code').notNull(),
		action: text('action', { enum: STORY_ACTIONS }).notNull(),
		source: text('source', { enum: STORY_SOURCES }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		index('story_version_storyId_idx').on(t.storyId),
		unique('story_version_story_version_unique').on(t.storyId, t.version),
	],
);

export const mcpQueryData = pgTable(
	'mcp_query_data',
	{
		queryId: text('query_id').primaryKey(),
		callLogId: text('call_log_id'),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		sourceChatId: text('source_chat_id'),
		columns: jsonb('columns').$type<string[]>().notNull(),
		data: jsonb('data').$type<Record<string, unknown>[]>().notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		index('mcp_query_data_project_id_idx').on(t.projectId),
		index('mcp_query_data_callLogId_idx').on(t.callLogId),
	],
);

export const mcpChartEmbed = pgTable(
	'mcp_chart_embed',
	{
		chartEmbedId: text('chart_embed_id').primaryKey(),
		queryId: text('query_id')
			.notNull()
			.references(() => mcpQueryData.queryId, { onDelete: 'cascade' }),
		chartConfig: jsonb('chart_config').$type<McpChartEmbedStoredConfig>().notNull(),
		sourceChatId: text('source_chat_id'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [index('mcp_chart_embed_query_id_idx').on(t.queryId)],
);

export const storyDataCache = pgTable('story_data_cache', {
	storyId: text('story_id')
		.notNull()
		.references(() => story.id, { onDelete: 'cascade' })
		.primaryKey(),
	queryData: jsonb('query_data').$type<Record<string, { data: unknown[]; columns: string[] }>>().notNull(),
	analysisResults: jsonb('analysis_results').$type<Record<string, string>>(),
	cachedAt: timestamp('cached_at').defaultNow().notNull(),
});

export const ACTIVITY_TYPES = [
	'story.refreshed',
	'story.shared',
	'story.pinned',
	'chat.shared',
	'chat.pinned',
] as const;

export const ACTIVITY_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;

export const ACTIVITY_TRIGGERS = ['schedule', 'manual', 'system'] as const;

export const activity = pgTable(
	'activity',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		type: text('type', { enum: ACTIVITY_TYPES }).notNull(),
		status: text('status', { enum: ACTIVITY_STATUSES }).notNull().default('completed'),
		trigger: text('trigger', { enum: ACTIVITY_TRIGGERS }).notNull().default('system'),
		storyId: text('story_id').references(() => story.id, { onDelete: 'set null' }),
		chatId: text('chat_id').references(() => chat.id, { onDelete: 'set null' }),
		sharedStoryId: text('shared_story_id').references(() => sharedStory.id, { onDelete: 'set null' }),
		sharedChatId: text('shared_chat_id').references(() => sharedChat.id, { onDelete: 'set null' }),
		payload: jsonb('payload').$type<Record<string, unknown>>(),
		errorMessage: text('error_message'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		completedAt: timestamp('completed_at'),
	},
	(t) => [
		index('activity_projectId_idx').on(t.projectId),
		index('activity_userId_idx').on(t.userId),
		index('activity_type_idx').on(t.type),
		index('activity_storyId_idx').on(t.storyId),
		index('activity_chatId_idx').on(t.chatId),
		index('activity_sharedStoryId_idx').on(t.sharedStoryId),
		index('activity_sharedChatId_idx').on(t.sharedChatId),
		index('activity_startedAt_idx').on(t.startedAt),
	],
);

export const memories = pgTable(
	'memories',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		content: text('content').notNull(),
		category: text('category', { enum: MEMORY_CATEGORIES }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		chatId: text('chat_id').references(() => chat.id, { onDelete: 'set null' }),
		supersededBy: text('superseded_by'),
	},
	(t) => [
		index('memories_userId_idx').on(t.userId),
		index('memories_chatId_idx').on(t.chatId),
		index('memories_supersededBy_idx').on(t.supersededBy),
	],
);

export const llmInference = pgTable(
	'llm_inference',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		chatId: text('chat_id').references(() => chat.id, { onDelete: 'set null' }),
		type: text('type', { enum: LLM_INFERENCE_TYPES }).notNull(),
		llmProvider: text('llm_provider').$type<LlmProvider>().notNull(),
		llmModelId: text('llm_model_id').notNull(),

		// Token usage
		inputTotalTokens: integer('input_total_tokens'),
		inputNoCacheTokens: integer('input_no_cache_tokens'),
		inputCacheReadTokens: integer('input_cache_read_tokens'),
		inputCacheWriteTokens: integer('input_cache_write_tokens'),
		outputTotalTokens: integer('output_total_tokens'),
		outputTextTokens: integer('output_text_tokens'),
		outputReasoningTokens: integer('output_reasoning_tokens'),
		totalTokens: integer('total_tokens'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		index('llm_inference_projectId_idx').on(t.projectId),
		index('llm_inference_userId_idx').on(t.userId),
		index('llm_inference_type_idx').on(t.type),
	],
);

export const messageImage = pgTable('message_image', {
	id: text('id')
		.$defaultFn(() => crypto.randomUUID())
		.primaryKey(),
	data: text('data').notNull(),
	mediaType: text('media_type').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const message_part_chart_image = pgTable('chart_image', {
	id: text('id')
		.$defaultFn(() => crypto.randomUUID())
		.primaryKey(),
	toolCallId: text('tool_call_id').notNull().unique(),
	data: text('data').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiKey = pgTable(
	'api_key',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		keyHash: text('key_hash').notNull().unique(),
		keyPrefix: text('key_prefix').notNull(),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		lastUsedAt: timestamp('last_used_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [index('api_key_orgId_idx').on(t.orgId)],
);

export const log = pgTable(
	'log',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		level: text('level', { enum: LOG_LEVELS }).notNull(),
		message: text('message').notNull(),
		context: jsonb('context').$type<Record<string, unknown>>(),
		source: text('source', { enum: LOG_SOURCES }).notNull(),
		projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		index('log_createdAt_idx').on(t.createdAt),
		index('log_level_idx').on(t.level),
		index('log_projectId_idx').on(t.projectId),
	],
);

export const scheduledJob = pgTable(
	'scheduled_job',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		name: text('name').notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>(),
		runAt: timestamp('run_at').notNull(),
		cron: text('cron'),
		status: text('status', { enum: ['pending', 'running', 'failed', 'paused'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(5),
		lastError: text('last_error'),
		lockedAt: timestamp('locked_at'),
		lockedBy: text('locked_by'),
		uniqueKey: text('unique_key').unique(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index('scheduled_job_status_runAt_idx').on(t.status, t.runAt), index('scheduled_job_name_idx').on(t.name)],
);

export const mcpCallLog = pgTable(
	'mcp_call_log',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		toolName: text('tool_name').notNull(),
		durationMs: integer('duration_ms'),
		success: boolean('success').notNull(),
		toolInput: jsonb('tool_input').$type<unknown>(),
		toolOutput: jsonb('tool_output').$type<unknown>(),
		calledAt: timestamp('called_at').defaultNow().notNull(),
	},
	(t) => [
		index('mcp_call_log_projectId_idx').on(t.projectId),
		index('mcp_call_log_userId_idx').on(t.userId),
		index('mcp_call_log_calledAt_idx').on(t.calledAt),
	],
);

export const oauthClient = pgTable(
	'oauth_client',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		clientId: text('client_id').notNull().unique(),
		clientSecret: text('client_secret'),
		disabled: boolean('disabled').default(false),
		skipConsent: boolean('skip_consent'),
		enableEndSession: boolean('enable_end_session'),
		subjectType: text('subject_type'),
		scopes: jsonb('scopes').$type<string[]>(),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		name: text('name'),
		uri: text('uri'),
		icon: text('icon'),
		contacts: jsonb('contacts').$type<string[]>(),
		tos: text('tos'),
		policy: text('policy'),
		softwareId: text('software_id'),
		softwareVersion: text('software_version'),
		softwareStatement: text('software_statement'),
		redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
		postLogoutRedirectUris: jsonb('post_logout_redirect_uris').$type<string[]>(),
		tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
		grantTypes: jsonb('grant_types').$type<string[]>(),
		responseTypes: jsonb('response_types').$type<string[]>(),
		public: boolean('public'),
		type: text('type'),
		requirePKCE: boolean('require_pkce'),
		referenceId: text('reference_id'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index('oauth_client_userId_idx').on(t.userId)],
);

export const oauthRefreshToken = pgTable(
	'oauth_refresh_token',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		token: text('token').notNull().unique(),
		clientId: text('client_id')
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: 'cascade' }),
		sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		referenceId: text('reference_id'),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		revoked: timestamp('revoked'),
		authTime: timestamp('auth_time'),
		scopes: jsonb('scopes').$type<string[]>().notNull(),
	},
	(t) => [
		index('oauth_refresh_token_clientId_idx').on(t.clientId),
		index('oauth_refresh_token_userId_idx').on(t.userId),
		index('oauth_refresh_token_sessionId_idx').on(t.sessionId),
	],
);

export const oauthAccessToken = pgTable(
	'oauth_access_token',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		token: text('token').notNull().unique(),
		clientId: text('client_id')
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: 'cascade' }),
		sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		referenceId: text('reference_id'),
		refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		scopes: jsonb('scopes').$type<string[]>().notNull(),
	},
	(t) => [
		index('oauth_access_token_clientId_idx').on(t.clientId),
		index('oauth_access_token_userId_idx').on(t.userId),
		index('oauth_access_token_refreshId_idx').on(t.refreshId),
	],
);

export const oauthConsent = pgTable(
	'oauth_consent',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		clientId: text('client_id')
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		referenceId: text('reference_id'),
		scopes: jsonb('scopes').$type<string[]>().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index('oauth_consent_clientId_idx').on(t.clientId), index('oauth_consent_userId_idx').on(t.userId)],
);

export const brandingConfig = pgTable('branding_config', {
	id: text('id').primaryKey(),
	appName: text('app_name'),
	tabTitle: text('tab_title'),
	logoData: text('logo_data'),
	logoMediaType: text('logo_media_type'),
	faviconData: text('favicon_data'),
	faviconMediaType: text('favicon_media_type'),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const jwks = pgTable('jwks', {
	id: text('id')
		.$defaultFn(() => crypto.randomUUID())
		.primaryKey(),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	expiresAt: timestamp('expires_at'),
});

export const favorite = pgTable(
	'favorite',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		storyId: text('story_id').references(() => story.id, { onDelete: 'cascade' }),
		folderId: text('folder_id').references((): AnyPgColumn => storyFolder.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [
		check('favorite_xor_target', sql`(${t.storyId} IS NOT NULL)::int + (${t.folderId} IS NOT NULL)::int = 1`),
		unique('favorite_user_id_story_id_unique').on(t.userId, t.storyId),
		unique('favorite_user_id_folder_id_unique').on(t.userId, t.folderId),
		index('favorite_user_id_idx').on(t.userId),
	],
);

export const storyFolder = pgTable(
	'story_folder',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		parentId: text('parent_id').references((): AnyPgColumn => storyFolder.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		visibility: text('visibility', { enum: FOLDER_VISIBILITY }).default('public').notNull(),
		systemType: text('system_type', { enum: FOLDER_SYSTEM_TYPE }),
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		uniqueIndex('story_folder_private_root_unique')
			.on(t.projectId, t.ownerId)
			.where(sql`${t.systemType} = 'private_folder'`),
		index('story_folder_ownerProjectParent_idx').on(t.ownerId, t.projectId, t.parentId),
		index('story_folder_projectId_idx').on(t.projectId),
	],
);

export const storyFolderItem = pgTable(
	'story_folder_item',
	{
		storyId: text('story_id')
			.notNull()
			.references(() => story.id, { onDelete: 'cascade' })
			.primaryKey(),
		folderId: text('folder_id')
			.notNull()
			.references(() => storyFolder.id, { onDelete: 'cascade' }),
	},
	(t) => [index('story_folder_item_folderId_idx').on(t.folderId)],
);
