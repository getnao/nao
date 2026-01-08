import { relations } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export type NewUser = typeof user.$inferInsert;
export type User = typeof user.$inferSelect;
export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;
export type ChatMessage = typeof chat_message.$inferSelect;
export type NewChatMessage = typeof chat_message.$inferInsert;
export type ToolCall = typeof tool_call.$inferSelect;
export type NewToolCall = typeof tool_call.$inferInsert;

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

export const conversation = pgTable(
	'conversation',
	{
		id: text('id').primaryKey(),
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
	(table) => [index('conversation_userId_idx').on(table.userId)],
);

export const chat_message = pgTable(
	'chat_message',
	{
		id: text('id').primaryKey(),
		conversationId: text('conversation_id')
			.notNull()
			.references(() => conversation.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
		content: text('content').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [index('chat_message_conversationId_idx').on(table.conversationId)],
);

export const tool_call = pgTable(
	'tool_call',
	{
		id: text('id').primaryKey(),
		messageId: text('message_id')
			.notNull()
			.references(() => chat_message.id, { onDelete: 'cascade' }),
		toolCallId: text('tool_call_id').notNull(),
		toolName: text('tool_name').notNull(),
		input: jsonb('input').$type<unknown>().notNull(),
		output: jsonb('output').$type<unknown>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [index('tool_call_messageId_idx').on(table.messageId)],
);

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
	conversations: many(conversation),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
	user: one(user, {
		fields: [conversation.userId],
		references: [user.id],
	}),
	messages: many(chat_message),
}));

export const chatMessageRelations = relations(chat_message, ({ one, many }) => ({
	conversation: one(conversation, {
		fields: [chat_message.conversationId],
		references: [conversation.id],
	}),
	toolCalls: many(tool_call),
}));

export const toolCallsRelations = relations(tool_call, ({ one }) => ({
	message: one(chat_message, {
		fields: [tool_call.messageId],
		references: [chat_message.id],
	}),
}));
