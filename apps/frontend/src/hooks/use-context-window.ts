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

export function estimateTokensFromTextLength(length: number): number {
    return Math.ceil(length / 4);
}

function estimateFromChars(messages: UIMessage[]): number {
    const totalChars = messages.reduce((sum, message) =>
        sum + message.parts.reduce((s, part) =>
            part.type === 'text' ? s + part.text.length : s, 0),
    0);
    return estimateTokensFromTextLength(totalChars);
}

// function getEstimatedTokens(messages: UIMessage[]): number {
//     const last = messages.at(-1);
//     if (!last) return 0;
    
//     if (last.tokenUsage?.inputTotalTokens != null) {
//         return (last.tokenUsage.inputTotalTokens) + (last.tokenUsage.outputTotalTokens ?? 0);
//     }
    
//     // Fallback : estimation sur tous les messages
//     const totalChars = messages.reduce((sum, message) =>
//         sum + message.parts.reduce((s, part) =>
//             part.type === 'text' ? s + part.text.length : s, 0),
//     0);
//     return estimateTokensFromTextLength(totalChars);
// }

function getEstimatedTokens(messages: UIMessage[]): number {
	const lastAssistantWithUsage = [...messages]
	  .reverse()
	  .find(m => m.tokenUsage?.inputTotalTokens != null);
  
	if (!lastAssistantWithUsage) {
	  return estimateFromChars(messages);
	}
  
	const baseContextTokens =
	  lastAssistantWithUsage.tokenUsage!.inputTotalTokens!;
  
	// Estimer uniquement les nouveaux messages ajoutés après
	const index = messages.indexOf(lastAssistantWithUsage);
	const messagesAfter = messages.slice(index + 1);
  
	const newChars = messagesAfter.reduce((sum, message) =>
	  sum + message.parts.reduce((s, part) =>
		part.type === 'text' ? s + part.text.length : s,
	  0),
	0);
  
	const estimatedNewTokens = estimateTokensFromTextLength(newChars);
  
	return baseContextTokens + estimatedNewTokens;
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
	console.log('percent used of context window', percent);
	return { usedTokens, contextWindow, percent };
}
