import { useQuery } from '@tanstack/react-query';
import { KNOWN_MODELS } from '@nao/backend/providers';
import type { UIMessage } from '@nao/backend/chat';

import type ChatSelectedModel from '@/types/ai';
import { trpc } from '@/main';

export function getAllContextWindows() {
	const results: { provider: string; modelId: string; name: string; contextWindow: number | null }[] = [];

	for (const [provider, models] of Object.entries(KNOWN_MODELS)) {
		models.forEach((m: any) => {
			let contextWindow: number | null = null;

			if (m.config?.thinking?.budgetTokens) {
				contextWindow = m.config.thinking.budgetTokens;
			}
			if (m.contextWindow) {
				contextWindow = m.contextWindow;
			}

			results.push({ provider, modelId: m.id, name: m.name, contextWindow });
		});
	}

	return results;
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function getEstimatedTokens(messages: UIMessage[]): number {
	return messages.reduce((total, message) => {
		if (message.tokenUsage?.inputTotalTokens || message.tokenUsage?.outputTotalTokens) {
			return total + (message.tokenUsage.inputTotalTokens ?? 0) + (message.tokenUsage.outputTotalTokens ?? 0);
		}
		const chars = message.parts.reduce((sum, part) => {
			if (part.type === 'text') {
				return sum + part.text.length;
			}
			return sum;
		}, 0);
		return total + estimateTokens(String(chars));
	}, 0);
}

export function useContextWindow(messages: UIMessage[], selectedModel: ChatSelectedModel | null) {
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());
	const allContextWindows = getAllContextWindows();
	const contextWindow =
		selectedModel && knownModels.data
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
