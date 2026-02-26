import { getToolName, isToolUIPart, jsonSchema } from 'ai';

import { KNOWN_MODELS } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/system-prompt';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { memoryService } from '../services/memory';
import type { UIMessage, UIMessagePart } from '../types/chat';
import type { ContextUsage } from '../types/chat';
import type { LlmProvider } from '../types/llm';
import { estimateTokens } from './ai';

const CHARS_PER_TOKEN = { natural: 4, structured: 3 } as const;

function charsFromPart(part: UIMessagePart): { chars: number; isStructured: boolean } {
	if (part.type === 'text') {
		return { chars: part.text.length, isStructured: false };
	}
	if (part.type === 'reasoning') {
		return { chars: part.text.length, isStructured: false };
	}
	if (isToolUIPart(part)) {
		let chars = getToolName(part).length;
		chars += JSON.stringify(part.input ?? {}).length;
		chars += JSON.stringify(part.output ?? '').length;
		if (part.errorText) {
			chars += part.errorText.length;
		}
		return { chars, isStructured: true };
	}
	return { chars: 0, isStructured: false };
}

function estimateTokensFromParts(messages: UIMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		for (const part of message.parts) {
			const { chars, isStructured } = charsFromPart(part);
			const divisor = isStructured ? CHARS_PER_TOKEN.structured : CHARS_PER_TOKEN.natural;
			tokens += Math.ceil(chars / divisor);
		}
	}
	return tokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function hasJsonSchemaField(value: unknown): value is { jsonSchema: unknown } {
	return isRecord(value) && 'jsonSchema' in value;
}

function isAiSdkSchemaLike(value: unknown): value is Parameters<typeof jsonSchema>[0] {
	return isRecord(value) && (typeof value.safeParse === 'function' || typeof value.parse === 'function');
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return '';
	}
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

function getContextWindow({ provider, modelId }: { provider: LlmProvider; modelId: string }): number | null {
	const models = KNOWN_MODELS[provider] ?? [];
	const contextWindow = models.find((m) => m.id === modelId)?.contextWindow;
	return contextWindow ?? null;
}

function clampPercent(percent: number): number {
	return Math.max(0, Math.min(100, percent));
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}K`;
	}
	return String(n);
}

function buildTooltipText({
	percent,
	usedTokens,
	contextWindow,
}: {
	percent: number;
	usedTokens: number;
	contextWindow: number | null;
}): string {
	const percentLabel = percent.toFixed(1);
	if (contextWindow != null) {
		return `${percentLabel}% used ${formatTokens(usedTokens)}/${formatTokens(contextWindow)}`;
	}
	return `${percentLabel}% used`;
}

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

	const messageTokens = baseContextTokens + estimateTokensFromParts(messages);

	let toolTokens = 0;
	let systemPromptTokens = 0;
	let usedTokens = messageTokens;

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
		usedTokens = messageTokens + toolTokens + systemPromptTokens;
	}

	const contextWindow = opts.model ? getContextWindow(opts.model) : null;
	const percentRaw = contextWindow && usedTokens > 0 ? (usedTokens / contextWindow) * 100 : 0;
	const percent =
		contextWindow && usedTokens > 0 ? Math.min(100, Math.max(0.1, parseFloat(percentRaw.toFixed(1)))) : 0;

	return {
		contextWindow,
		percent: clampPercent(percent),
		tooltipText: buildTooltipText({ percent: clampPercent(percent), usedTokens, contextWindow }),
	};
}
