import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { LlmProvider } from '@nao/shared/types';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

import { env } from '../env';
import * as creditWalletService from '../services/credit-wallet.service';
import type { TokenUsage } from '../types/chat';
import type { ModelCosts } from '../types/llm';
import type { ManagedAiUsageCategory, ManagedAiUsageStatus } from '../types/managed-ai-usage';
import { getProviderMeta } from './providers';

const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export type ManagedAiUsageContext = {
	userId?: string;
	projectId?: string;
	chatId?: string;
	orgId?: string;
	messageId?: string;
	runId?: string;
	category: ManagedAiUsageCategory;
};

export function isManagedAiEnabled(): boolean {
	return (
		env.NAO_MODE === 'cloud' &&
		Boolean(process.env.NAO_MANAGED_OPENAI_API_KEY) &&
		!env.DISABLED_PROVIDERS.includes('nao')
	);
}

export function withManagedAiUsageMetering(
	model: LanguageModelV3,
	provider: LlmProvider,
	modelId: string,
	context: ManagedAiUsageContext,
	declaredCosts?: ModelCosts,
): LanguageModelV3 {
	if (provider !== 'nao') {
		return model;
	}
	context.runId ??= crypto.randomUUID();
	return wrapLanguageModel({
		model,
		middleware: createManagedAiUsageMiddleware(modelId, context, declaredCosts),
	});
}

function createManagedAiUsageMiddleware(
	modelId: string,
	context: ManagedAiUsageContext,
	declaredCosts?: ModelCosts,
): LanguageModelMiddleware {
	const rates = resolveRates('nao', modelId, declaredCosts);
	return {
		specificationVersion: 'v3',
		wrapGenerate: async ({ doGenerate, params }) => {
			const operationId = crypto.randomUUID();
			await prepareCall(context, rates, params, operationId);
			const startedAt = new Date();
			let result;
			try {
				result = await doGenerate();
			} catch (error) {
				await recordManagedAiUsage({
					operationId,
					startedAt,
					modelId,
					context,
					status: 'failed',
					usage: estimateUsage(params, 0),
					rates,
				});
				throw error;
			}
			await recordManagedAiUsage({
				operationId,
				startedAt,
				modelId,
				context,
				status: 'completed',
				usage: result.usage,
				rates,
				finishReason: result.finishReason.unified,
				providerRequestId: result.response?.id,
			});
			return result;
		},
		wrapStream: async ({ doStream, params }) => {
			const operationId = crypto.randomUUID();
			await prepareCall(context, rates, params, operationId);
			const startedAt = new Date();
			let result;
			try {
				result = await doStream();
			} catch (error) {
				await recordManagedAiUsage({
					operationId,
					startedAt,
					modelId,
					context,
					status: 'failed',
					usage: estimateUsage(params, 0),
					rates,
				});
				throw error;
			}
			const { stream, ...rest } = result;
			return {
				...rest,
				stream: stream.pipeThrough(
					createStreamMeter({
						operationId,
						startedAt,
						modelId,
						context,
						rates,
						params,
					}),
				),
			};
		},
	};
}

type ManagedAiStreamMeterOptions = {
	operationId: string;
	startedAt: Date;
	modelId: string;
	context: ManagedAiUsageContext;
	rates: ModelCosts | undefined;
	params: LanguageModelV3CallOptions;
};

function createStreamMeter(
	options: ManagedAiStreamMeterOptions,
): TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart> {
	let recorded = false;
	let streamedChars = 0;
	let providerRequestId: string | undefined;
	const recordOnce = async (status: ManagedAiUsageStatus, usage: LanguageModelV3Usage, finishReason?: string) => {
		if (recorded) {
			return;
		}
		recorded = true;
		await recordManagedAiUsage({ ...options, status, usage, finishReason, providerRequestId });
	};

	options.params.abortSignal?.addEventListener(
		'abort',
		() => void recordOnce('aborted', estimateUsage(options.params, streamedChars)),
		{ once: true },
	);

	return new TransformStream({
		async transform(chunk, controller) {
			if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-input-delta') {
				streamedChars += chunk.delta.length;
			} else if (chunk.type === 'response-metadata') {
				providerRequestId = chunk.id;
			} else if (chunk.type === 'finish') {
				await recordOnce('completed', chunk.usage, chunk.finishReason.unified);
			} else if (chunk.type === 'error') {
				await recordOnce('failed', estimateUsage(options.params, streamedChars));
			}
			controller.enqueue(chunk);
		},
	});
}

// ponytail: chars/4 over the serialized prompt (including base64 attachments) and streamed deltas is
// a coarse stand-in for the usage the provider never reports on abort. Upgrade: a tokenizer-based count.
function estimateUsage(params: LanguageModelV3CallOptions, streamedChars: number): LanguageModelV3Usage {
	const inputTokens = Math.ceil((JSON.stringify(params.prompt) ?? '').length / 4);
	const outputTokens = Math.ceil(streamedChars / 4);
	return {
		inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
	};
}

async function prepareCall(
	context: ManagedAiUsageContext,
	rates: ModelCosts | undefined,
	params: LanguageModelV3CallOptions,
	operationId: string,
): Promise<void> {
	if (!context.userId) {
		throw new Error('Managed AI usage requires an initiating user.');
	}
	if (!context.orgId) {
		throw new Error('Managed AI usage requires a billed organization.');
	}
	if (!rates) {
		throw new Error('Managed model has no configured token pricing.');
	}
	await creditWalletService.reserveManagedAiCredits(
		context.orgId,
		operationId,
		calculateReservationMicroUsd(params, rates),
	);
}

type RecordManagedAiUsageOptions = {
	operationId: string;
	startedAt: Date;
	modelId: string;
	context: ManagedAiUsageContext;
	status: ManagedAiUsageStatus;
	usage: LanguageModelV3Usage;
	rates: ModelCosts | undefined;
	finishReason?: string;
	providerRequestId?: string;
};

// ponytail: a process crash during a provider call leaves its durable reservation unsettled.
// Upgrade to provider reconciliation and stale-reservation release before paid balances launch.
async function recordManagedAiUsage(options: RecordManagedAiUsageOptions): Promise<void> {
	const tokenUsage = toTokenUsage(options.usage);
	const costs = calculateCosts(tokenUsage, options.rates);
	const costSource = options.rates ? (options.status === 'completed' ? 'price_book' : 'estimated') : 'unknown';
	await creditWalletService.recordManagedAiUsageAndChargeWallet(
		{
			operationId: options.operationId,
			runId: options.context.runId ?? options.operationId,
			userId: options.context.userId,
			orgId: options.context.orgId,
			projectId: options.context.projectId,
			chatId: options.context.chatId,
			chatMessageId: options.context.messageId,
			category: options.context.category,
			llmProvider: 'nao',
			llmModelId: options.modelId,
			status: options.status,
			finishReason: options.finishReason,
			providerRequestId: options.providerRequestId,
			inputTotalTokens: tokenUsage.inputTotalTokens,
			inputNoCacheTokens: tokenUsage.inputNoCacheTokens ?? 0,
			inputCacheReadTokens: tokenUsage.inputCacheReadTokens ?? 0,
			inputCacheWriteTokens: tokenUsage.inputCacheWriteTokens ?? 0,
			outputTotalTokens: tokenUsage.outputTotalTokens ?? 0,
			outputTextTokens: tokenUsage.outputTextTokens,
			outputReasoningTokens: tokenUsage.outputReasoningTokens ?? 0,
			totalTokens: tokenUsage.totalTokens,
			inputNoCacheRateMicroUsdPerMillionTokens: toMicroUsd(options.rates?.inputNoCache),
			inputCacheReadRateMicroUsdPerMillionTokens: toMicroUsd(options.rates?.inputCacheRead),
			inputCacheWriteRateMicroUsdPerMillionTokens: toMicroUsd(options.rates?.inputCacheWrite),
			outputRateMicroUsdPerMillionTokens: toMicroUsd(options.rates?.output),
			...costs,
			upstreamCostMicroUsd: costs.total,
			costSource,
			startedAt: options.startedAt,
			completedAt: new Date(),
		},
		costs.total ?? 0,
	);
}

function resolveRates(provider: LlmProvider, modelId: string, declaredCosts?: ModelCosts): ModelCosts | undefined {
	const builtInCosts = getProviderMeta(provider).models.find((model) => model.id === modelId)?.costPerM;
	return builtInCosts || declaredCosts ? { ...builtInCosts, ...declaredCosts } : undefined;
}

function calculateCosts(
	usage: TokenUsage,
	rates?: ModelCosts,
): {
	inputNoCacheCostMicroUsd?: number;
	inputCacheReadCostMicroUsd?: number;
	inputCacheWriteCostMicroUsd?: number;
	outputCostMicroUsd?: number;
	total?: number;
} {
	if (!rates) {
		return {};
	}
	const result = {
		inputNoCacheCostMicroUsd: calculateCategoryCost(usage.inputNoCacheTokens, rates.inputNoCache),
		inputCacheReadCostMicroUsd: calculateCategoryCost(usage.inputCacheReadTokens, rates.inputCacheRead),
		inputCacheWriteCostMicroUsd: calculateCategoryCost(usage.inputCacheWriteTokens, rates.inputCacheWrite),
		outputCostMicroUsd: calculateCategoryCost(usage.outputTotalTokens, rates.output),
	};
	return { ...result, total: Object.values(result).reduce((sum, cost) => sum + cost, 0) };
}

function calculateCategoryCost(tokens?: number, rateUsdPerMillion?: number): number {
	return Math.ceil(((tokens ?? 0) * (rateUsdPerMillion ?? 0) * 1_000_000) / 1_000_000);
}

function calculateReservationMicroUsd(params: LanguageModelV3CallOptions, rates: ModelCosts): number {
	const estimatedInputTokens = estimateUsage(params, 0).inputTokens.total ?? 0;
	const highestInputRate = Math.max(rates.inputNoCache ?? 0, rates.inputCacheRead ?? 0, rates.inputCacheWrite ?? 0);
	const outputTokens = params.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
	return Math.max(
		1,
		calculateCategoryCost(estimatedInputTokens, highestInputRate) +
			calculateCategoryCost(outputTokens, rates.output),
	);
}

function toMicroUsd(rateUsdPerMillion?: number): number | undefined {
	return rateUsdPerMillion === undefined ? undefined : Math.round(rateUsdPerMillion * 1_000_000);
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
