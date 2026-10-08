import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

import { env } from '../env';
import * as managedAiUsageQueries from '../queries/managed-ai-usage.queries';
import type { TokenUsage } from '../types/chat';
import { convertToCost } from '../utils/ai';
import { ManagedCreditsExhaustedError } from '../utils/error';
import { logger } from '../utils/logger';

export type ManagedAiContext = {
	userId: string;
	projectId?: string;
	chatId?: string;
	orgId?: string;
};

export function isManagedAiEnabled(): boolean {
	return (
		env.NAO_MODE === 'cloud' &&
		Boolean(process.env.NAO_MANAGED_OPENAI_API_KEY) &&
		!env.DISABLED_PROVIDERS.includes('nao')
	);
}

export function withManagedAiMetering(
	model: LanguageModelV3,
	modelId: string,
	context: ManagedAiContext,
): LanguageModelV3 {
	return wrapLanguageModel({ model, middleware: createManagedAiMiddleware(modelId, context) });
}

function createManagedAiMiddleware(modelId: string, context: ManagedAiContext): LanguageModelMiddleware {
	return {
		specificationVersion: 'v3',
		wrapGenerate: async ({ doGenerate }) => {
			await assertManagedAiCreditsAvailable(context.userId);
			const result = await doGenerate();
			await recordManagedAiUsage(modelId, context, result.usage);
			return result;
		},
		wrapStream: async ({ doStream, params }) => {
			await assertManagedAiCreditsAvailable(context.userId);
			const { stream, ...rest } = await doStream();
			return { ...rest, stream: stream.pipeThrough(createStreamMeter(modelId, context, params)) };
		},
	};
}

/**
 * Records usage once per stream: from the `finish` part, or from an estimate when the caller
 * aborts before it arrives, since the provider bills aborted generations too.
 */
function createStreamMeter(
	modelId: string,
	context: ManagedAiContext,
	params: LanguageModelV3CallOptions,
): TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart> {
	let recorded = false;
	let streamedChars = 0;
	const recordOnce = async (usage: LanguageModelV3Usage) => {
		if (recorded) {
			return;
		}
		recorded = true;
		await recordManagedAiUsage(modelId, context, usage);
	};

	params.abortSignal?.addEventListener('abort', () => void recordOnce(estimateUsage(params, streamedChars)), {
		once: true,
	});

	return new TransformStream({
		async transform(chunk, controller) {
			if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
				streamedChars += chunk.delta.length;
			} else if (chunk.type === 'finish') {
				await recordOnce(chunk.usage);
			}
			controller.enqueue(chunk);
		},
	});
}

// ponytail: chars/4 over the serialized prompt (including base64 attachments) and streamed deltas is
// a coarse stand-in for the usage the provider never reports on abort. Upgrade: a tokenizer-based count.
function estimateUsage(params: LanguageModelV3CallOptions, streamedChars: number): LanguageModelV3Usage {
	const inputTokens = Math.ceil(JSON.stringify(params.prompt).length / 4);
	const outputTokens = Math.ceil(streamedChars / 4);
	return {
		inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
	};
}

// ponytail: check-then-insert is not atomic, so concurrent calls can overspend by one request each.
// Acceptable for a $5 grant; upgrade: hold/settle on a credit account before paid balances.
async function assertManagedAiCreditsAvailable(userId: string): Promise<void> {
	const spent = await managedAiUsageQueries.getManagedAiSpendMicroUsd(userId);
	if (spent >= managedAiUsageQueries.MANAGED_AI_ALLOWANCE_MICRO_USD) {
		throw new ManagedCreditsExhaustedError();
	}
}

/** Never fails the user's completed response: the provider has already been paid at this point. */
async function recordManagedAiUsage(
	modelId: string,
	context: ManagedAiContext,
	usage: LanguageModelV3Usage,
): Promise<void> {
	try {
		const tokenUsage = toTokenUsage(usage);
		const cost = convertToCost(tokenUsage, 'nao', modelId).totalCost;
		if (cost === undefined) {
			throw new Error(`Managed model ${modelId} has no configured token pricing.`);
		}

		await managedAiUsageQueries.insertManagedAiUsage({
			userId: context.userId,
			orgId: context.orgId,
			projectId: context.projectId,
			chatId: context.chatId,
			modelId,
			inputNoCacheTokens: tokenUsage.inputNoCacheTokens ?? 0,
			inputCacheReadTokens: tokenUsage.inputCacheReadTokens ?? 0,
			inputCacheWriteTokens: tokenUsage.inputCacheWriteTokens ?? 0,
			outputTokens: tokenUsage.outputTotalTokens ?? 0,
			reasoningTokens: tokenUsage.outputReasoningTokens ?? 0,
			costMicroUsd: Math.ceil(cost * 1_000_000),
		});
	} catch (error) {
		logger.error(`Managed AI usage was not recorded: ${String(error)}`, {
			source: 'agent',
			projectId: context.projectId,
			context: { userId: context.userId, chatId: context.chatId, modelId },
		});
	}
}

function toTokenUsage(usage: LanguageModelV3Usage): TokenUsage {
	const inputCacheReadTokens = usage.inputTokens.cacheRead ?? 0;
	const inputCacheWriteTokens = usage.inputTokens.cacheWrite ?? 0;
	const inputNoCacheTokens =
		usage.inputTokens.noCache ??
		Math.max(0, (usage.inputTokens.total ?? 0) - inputCacheReadTokens - inputCacheWriteTokens);
	const outputTotalTokens = usage.outputTokens.total ?? 0;

	return {
		inputTotalTokens: usage.inputTokens.total,
		inputNoCacheTokens,
		inputCacheReadTokens,
		inputCacheWriteTokens,
		outputTotalTokens,
		outputTextTokens: usage.outputTokens.text,
		outputReasoningTokens: usage.outputTokens.reasoning,
		totalTokens: (usage.inputTokens.total ?? 0) + outputTotalTokens,
	};
}
