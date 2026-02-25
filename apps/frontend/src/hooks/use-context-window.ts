import { useQuery } from '@tanstack/react-query';
import { KNOWN_MODELS } from '@nao/backend/providers';
import type { UIMessage, UIMessagePart } from '@nao/backend/chat';

import type ChatSelectedModel from '@/types/ai';
import { getToolName, isToolUIPart } from '@/lib/ai';
import { trpc } from '@/main';

export function getAllContextWindows() {
	const results: { provider: string; modelId: string; name: string; contextWindow: number | null }[] = [];

	for (const [provider, models] of Object.entries(KNOWN_MODELS)) {
		models.forEach((m: { id: string; name: string; contextWindow?: number }) => {
			results.push({ provider, modelId: m.id, name: m.name, contextWindow: m.contextWindow ?? null });
		});
	}

	return results;
}

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

function getEstimatedTokens(messages: UIMessage[]): number {
	const lastAssistantWithUsage = [...messages].reverse().find((m) => m.tokenUsage?.inputTotalTokens != null);

	if (!lastAssistantWithUsage) {
		return estimateTokensFromParts(messages);
	}

	const usage = lastAssistantWithUsage.tokenUsage!;
	const baseContextTokens = (usage.inputTotalTokens ?? 0) + (usage.outputTotalTokens ?? 0);

	const index = messages.indexOf(lastAssistantWithUsage);
	const messagesAfter = messages.slice(index + 1);

	return baseContextTokens + estimateTokensFromParts(messagesAfter);
}

export function useContextWindow(messages: UIMessage[], selectedModel: ChatSelectedModel | null) {
	const allContextWindows = getAllContextWindows();
	const contextWindow =
		selectedModel && KNOWN_MODELS[selectedModel.provider]
			? (allContextWindows.find(
					(cw) => cw.provider === selectedModel.provider && cw.modelId === selectedModel.modelId,
				)?.contextWindow ?? null)
			: null;

	const usedTokens = getEstimatedTokens(messages);
	const percent =
		contextWindow && usedTokens > 0
			? Math.min(100, Math.max(0.1, parseFloat(((usedTokens / contextWindow) * 100).toFixed(1))))
			: 0;

	return { usedTokens, contextWindow, percent };
}
