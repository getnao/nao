import { z } from 'zod/v4';

import type { MessageCustomDataParts } from './chat';

/** A turn the user's own Claude runs on their machine, with nao's tools reached over MCP. */
export type LocalAgentTurnRequest = z.infer<typeof LocalAgentTurnRequestSchema>;
export const LocalAgentTurnRequestSchema = z.object({
	chatId: z.string().optional(),
	messageToEditId: z.string().optional(),
	message: z.object({ text: z.string().min(1).max(100_000) }),
	timezone: z.string().max(100).optional(),
});

export interface LocalAgentTurn {
	chatId: string;
	isNewChat: boolean;
	newChat?: MessageCustomDataParts['newChat'];
	userMessageId: string;
	systemPrompt: string;
	/** Earlier messages of the chat as text, for the new Claude session to pick the conversation up. */
	history: string | null;
	mcp: { url: string; token: string };
}

export type LocalAgentTurnCompletion = z.infer<typeof LocalAgentTurnCompletionSchema>;
export const LocalAgentTurnCompletionSchema = z.object({
	chatId: z.string(),
	message: z.object({
		id: z.string(),
		role: z.literal('assistant'),
		parts: z.array(z.looseObject({ type: z.string() })).max(2_000),
	}),
	modelId: z.string().max(200),
	stopReason: z.enum(['stop', 'error', 'interrupted']),
	errorMessage: z.string().max(10_000).optional(),
	usage: z
		.object({
			inputTokens: z.number().optional(),
			cacheReadInputTokens: z.number().optional(),
			cacheCreationInputTokens: z.number().optional(),
			outputTokens: z.number().optional(),
		})
		.optional(),
});

export interface LocalAgentTokenClaims {
	userId: string;
	projectId: string;
	chatId: string;
	expiresAt: number;
}
