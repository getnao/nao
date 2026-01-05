import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';

import { db } from './db';
import {
	chat_message,
	ChatMessage,
	Conversation,
	conversation,
	NewChatMessage,
	NewConversation,
	NewToolCall,
	tool_calls,
	ToolCall,
} from './schema';

export const dbService = {
	// Conversation operations
	async createConversation(data: Omit<NewConversation, 'id'>): Promise<string> {
		const id = randomUUID();
		const newConversation: NewConversation = {
			id,
			...data,
		};

		await db.insert(conversation).values(newConversation);

		return id;
	},

	async updateConversation(id: string, data: Partial<Omit<NewConversation, 'id'>>): Promise<Conversation | null> {
		await db.update(conversation).set(data).where(eq(conversation.id, id));

		const result = await db.select().from(conversation).where(eq(conversation.id, id));
		return result[0] || null;
	},

	async getConversation(id: string): Promise<Conversation | null> {
		const result = await db.select().from(conversation).where(eq(conversation.id, id));
		return result[0] || null;
	},

	async getConversationsByUserId(userId: string): Promise<Conversation[]> {
		return db
			.select()
			.from(conversation)
			.where(eq(conversation.userId, userId))
			.orderBy(desc(conversation.updatedAt));
	},

	async deleteConversation(id: string): Promise<void> {
		await db.delete(conversation).where(eq(conversation.id, id));
	},

	// ChatMessage operations
	async createChatMessage(data: Omit<NewChatMessage, 'id'> & { id: string }): Promise<string> {
		const id = data.id;
		const newMessage: NewChatMessage = {
			id,
			conversationId: data.conversationId,
			role: data.role,
			content: data.content,
		};

		await db.insert(chat_message).values(newMessage);

		return id;
	},

	async getChatMessage(id: string): Promise<ChatMessage | null> {
		const result = await db.select().from(chat_message).where(eq(chat_message.id, id));
		return result[0] || null;
	},

	async getChatMessagesByConversationId(conversationId: string): Promise<ChatMessage[]> {
		return db.select().from(chat_message).where(eq(chat_message.conversationId, conversationId));
	},

	async deleteChatMessage(id: string): Promise<void> {
		await db.delete(chat_message).where(eq(chat_message.id, id));
	},

	// ToolCall operations
	async createToolCall(data: Omit<NewToolCall, 'id'>): Promise<string> {
		const id = randomUUID();
		const newToolCall: NewToolCall = {
			id,
			...data,
		};

		await db.insert(tool_calls).values(newToolCall);

		return id;
	},

	async updateToolCall(id: string, data: Partial<Omit<NewToolCall, 'id'>>): Promise<ToolCall | null> {
		await db.update(tool_calls).set(data).where(eq(tool_calls.id, id));

		const result = await db.select().from(tool_calls).where(eq(tool_calls.id, id));
		return result[0] || null;
	},

	async getToolCall(id: string): Promise<ToolCall | null> {
		const result = await db.select().from(tool_calls).where(eq(tool_calls.id, id));
		return result[0] || null;
	},

	async getToolCallsByMessageId(messageId: string): Promise<ToolCall[]> {
		return db.select().from(tool_calls).where(eq(tool_calls.messageId, messageId));
	},

	async deleteToolCall(id: string): Promise<void> {
		await db.delete(tool_calls).where(eq(tool_calls.id, id));
	},
};
