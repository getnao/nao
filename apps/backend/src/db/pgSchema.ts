import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from 'drizzle-orm/pg-core';

import { StopReason, ToolState, UIMessagePartType } from '../types/chat';
import { LlmProvider } from '../types/llm';
import { USER_ROLES } from '../types/project';

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').default(false).notNull(),
	image: text('image'),
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

export const project = pgTable(
	'project',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		name: text('name').notNull(),
		type: text('type', { enum: ['local'] }).notNull(),
		path: text('path'),
		slackBotToken: text('slack_bot_token'),
		slackSigningSecret: text('slack_signing_secret'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		check(
			'local_project_path_required',
			sql`CASE WHEN ${t.type} = 'local' THEN ${t.path} IS NOT NULL ELSE TRUE END`,
		),
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
		slackThreadId: text('slack_thread_id'),
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
		createdAt: timestamp('created_at').defaultNow().notNull(),
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

		// Input tokens columns
		inputTotalTokens: integer('input_total_tokens'),
		inputNoCacheTokens: integer('input_no_cache_tokens'),
		inputCacheReadTokens: integer('input_cache_read_tokens'),
		inputCacheWriteTokens: integer('input_cache_write_tokens'),

		// Output tokens columns
		outputTotalTokens: integer('output_total_tokens'),
		outputTextTokens: integer('output_text_tokens'),
		outputReasoningTokens: integer('output_reasoning_tokens'),

		// Total tokens column
		totalTokens: integer('total_tokens'),

		// tool call columns
		toolCallId: text('tool_call_id'),
		toolName: text('tool_name'),
		toolState: text('tool_state').$type<ToolState>(),
		toolErrorText: text('tool_error_text'),
		toolInput: jsonb('tool_input').$type<unknown>(),
		toolOutput: jsonb('tool_output').$type<unknown>(),

		// tool approval columns
		toolApprovalId: text('tool_approval_id'),
		toolApprovalApproved: boolean('tool_approval_approved'),
		toolApprovalReason: text('tool_approval_reason'),
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
		enabledModels: jsonb('enabled_models').$type<string[]>().default([]).notNull(),
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
