import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { ToolState, UIMessagePartType } from '../types/chat';

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

export const chat = pgTable(
	'chat',
	{
		id: text('id')
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull().default('New Conversation'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index('chat_userId_idx').on(table.userId)],
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
