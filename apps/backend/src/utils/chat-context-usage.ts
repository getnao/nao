import { getToolName, isToolUIPart, jsonSchema } from 'ai';

import { KNOWN_MODELS } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/ai';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { memoryService } from '../services/memory';
import type { UIMessage, UIMessagePart } from '../types/chat';
import type { ContextUsage } from '../types/chat';
import type { LlmProvider } from '../types/llm';
import { estimateTokens } from './ai';

type TokenizableText = { text: string; type: 'json' | 'text' };

export async function getChatContextUsage(opts: {
	chatId: string;
	userId: string;
	model?: { provider: LlmProvider; modelId: string };
}): Promise<ContextUsage | null> {
	const anchor = await chatQueries.getLastAssistantMessageWithTokenUsage(opts.chatId);
	const hasAnchorUsage = anchor !== null;
	const baseContextTokens = hasAnchorUsage ? (anchor!.totalTokens ?? 0) : 0;
	const messages = hasAnchorUsage
		? await chatQueries.loadChatMessagesAfter(opts.chatId, anchor!.createdAt)
		: await chatQueries.loadChatMessages(opts.chatId);

	const messageTokens = baseContextTokens + estimateTokensFromMessages(messages);

	let toolTokens = 0;
	let systemPromptTokens = 0;
	let tokensUsed = messageTokens;

	if (!hasAnchorUsage) {
		const projectId = await chatQueries.getChatProjectId(opts.chatId);
		if (!projectId) {
			return null;
		}
		const agentSettings = await projectQueries.getAgentSettings(projectId);
		const tools = getTools(agentSettings);
		const toolPromptText = getToolPromptText(tools);

		const memories = await memoryService.safeGetUserMemories(opts.userId, projectId, opts.chatId);
		const systemPromptText = renderToMarkdown(SystemPrompt({ memories }));

		toolTokens = estimateTokens(toolPromptText);
		systemPromptTokens = estimateTokens(systemPromptText);
		tokensUsed = messageTokens + toolTokens + systemPromptTokens;
	}

	const contextWindow = opts.model ? getContextWindow(opts.model) : null;

	return {
		tokensUsed,
		contextWindow,
	};
}

function getContextWindow({ provider, modelId }: { provider: LlmProvider; modelId: string }): number | null {
	const models = KNOWN_MODELS[provider] ?? [];
	const contextWindow = models.find((m) => m.id === modelId)?.contextWindow;
	return contextWindow ?? null;
}

function estimateTokensFromMessages(messages: UIMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		for (const part of message.parts) {
			const { text, type } = getTokenizableTextFromPart(part);
			tokens += estimateTokens(text, type);
		}
	}
	return tokens;
}

function getTokenizableTextFromPart(part: UIMessagePart): TokenizableText {
	if (part.type === 'text') {
		return { text: part.text, type: 'text' };
	}
	if (part.type === 'reasoning') {
		return { text: part.text, type: 'text' };
	}
	if (isToolUIPart(part)) {
		const chunks = [
			getToolName(part),
			JSON.stringify(part.input ?? {}),
			JSON.stringify(part.output ?? ''),
			part.errorText ?? '',
		];
		return { text: chunks.join(''), type: 'json' };
	}
	return { text: '', type: 'text' };
}

function getToolPromptText(tools: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [name, tool] of Object.entries(tools)) {
		const description = isRecord(tool) && typeof tool.description === 'string' ? tool.description : '';
		const inputSchema = isRecord(tool) ? tool.inputSchema : undefined;
		const schemaText = getSchemaText(inputSchema);

		lines.push([name, description, schemaText].filter(Boolean).join('\n'));
	}
	return lines.join('\n');
}

function getSchemaText(schema: unknown): string {
	if (!schema) {
		return '';
	}
	const resolved = hasJsonSchemaField(schema)
		? schema.jsonSchema
		: isAiSdkSchemaLike(schema)
			? (() => {
					try {
						return jsonSchema(schema);
					} catch {
						return schema;
					}
				})()
			: schema;

	return safeStringify(resolved);
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return '';
	}
}

function isAiSdkSchemaLike(value: unknown): value is Parameters<typeof jsonSchema>[0] {
	return isRecord(value) && (typeof value.safeParse === 'function' || typeof value.parse === 'function');
}

function hasJsonSchemaField(value: unknown): value is { jsonSchema: unknown } {
	return isRecord(value) && 'jsonSchema' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
