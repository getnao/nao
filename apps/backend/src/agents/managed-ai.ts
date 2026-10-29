import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { LlmProvider } from '@nao/shared/types';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

import { env } from '../env';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import * as projectQueries from '../queries/project.queries';
import { MAX_OUTPUT_TOKENS } from '../services/agent';
import * as creditWalletService from '../services/credit-wallet.service';
import type { TokenUsage } from '../types/chat';
import type { ModelCosts, ModelSource } from '../types/llm';
import type { ManagedAiUsageCategory, ManagedAiUsageCostSource, ManagedAiUsageStatus } from '../types/managed-ai-usage';
import { logger } from '../utils/logger';
import { createProviderModel, getProviderMeta } from './providers';

export type ManagedAiUsageContext = {
	userId?: string;
	projectId?: string;
	chatId?: string;
	orgId?: string;
	messageId?: string;
	runId?: string;
	category: ManagedAiUsageCategory;
	billingMode?: 'wallet' | 'unbilled';
};

export function isManagedAiEnabled(): boolean {
	return (
		env.NAO_MODE === 'cloud' && Boolean(env.NAO_MANAGED_OPENAI_API_KEY) && !env.DISABLED_PROVIDERS.includes('nao')
	);
}

/** Serves the `nao` models on nao's own OpenAI key and bills every call to the organization's credit wallet. */
export const managedAiSource: ModelSource = {
	managed: true,

	async listProviders(projectId) {
		if (!isManagedAiEnabled() || !(await hasWalletBalance(projectId))) {
			return [];
		}
		const enabledModels = getProviderMeta('nao').models.map((model) => model.id);
		return [{ provider: 'nao', enabledModels, customModels: [], baseUrl: null }];
	},

	async resolveModel({ projectId, provider, modelId, usageContext }) {
		const apiKey = env.NAO_MANAGED_OPENAI_API_KEY;
		if (!isManagedAiEnabled() || !apiKey || !usageContext?.userId || !isManagedModel(provider, modelId)) {
			return null;
		}
		const orgId = usageContext.orgId ?? (await projectQueries.getProjectById(projectId))?.orgId ?? undefined;
		const result = createProviderModel(provider, { apiKey }, modelId);
		return {
			...result,
			model: withManagedAiUsageMetering(result.model, provider, modelId, {
				...usageContext,
				projectId,
				orgId,
			}),
		};
	},
};

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
				stream: meterStream(stream, {
					operationId,
					startedAt,
					modelId,
					context,
					rates,
					params,
				}),
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

function meterStream(
	stream: ReadableStream<LanguageModelV3StreamPart>,
	options: ManagedAiStreamMeterOptions,
): ReadableStream<LanguageModelV3StreamPart> {
	let streamedChars = 0;
	let providerRequestId: string | undefined;
	let recording: Promise<void> | undefined;
	const recordOnce = async (status: ManagedAiUsageStatus, usage: LanguageModelV3Usage, finishReason?: string) => {
		if (!recording) {
			options.params.abortSignal?.removeEventListener('abort', recordAbort);
			recording = recordManagedAiUsage({ ...options, status, usage, finishReason, providerRequestId });
		}
		await recording;
	};
	const estimatedUsage = () => estimateUsage(options.params, streamedChars);
	const recordAbort = () => {
		recording = recordOnce('aborted', estimatedUsage()).catch((error) => {
			logger.error(`Failed to record aborted managed AI stream: ${String(error)}`, {
				source: 'agent',
				projectId: options.context.projectId,
				context: { operationId: options.operationId },
			});
		});
	};

	options.params.abortSignal?.addEventListener('abort', recordAbort, { once: true });

	const reader = stream.getReader();
	return new ReadableStream({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					await recordOnce(options.params.abortSignal?.aborted ? 'aborted' : 'failed', estimatedUsage());
					controller.close();
					return;
				}
				const chunk = result.value;
				if (
					chunk.type === 'text-delta' ||
					chunk.type === 'reasoning-delta' ||
					chunk.type === 'tool-input-delta'
				) {
					streamedChars += chunk.delta.length;
				} else if (chunk.type === 'response-metadata') {
					providerRequestId = chunk.id;
				} else if (chunk.type === 'finish') {
					await recordOnce('completed', chunk.usage, chunk.finishReason.unified);
				} else if (chunk.type === 'error') {
					await recordOnce('failed', estimatedUsage());
				}
				controller.enqueue(chunk);
			} catch (error) {
				try {
					await recordOnce(options.params.abortSignal?.aborted ? 'aborted' : 'failed', estimatedUsage());
				} finally {
					controller.error(error);
				}
			}
		},
		async cancel(reason) {
			await Promise.all([reader.cancel(reason), recordOnce('aborted', estimatedUsage())]);
		},
	});
}

// ponytail: chars/4 over the serialized prompt, tool definitions, and streamed deltas is a coarse
// stand-in for the usage the provider never reports on abort. Upgrade: a tokenizer-based count.
function estimateUsage(params: LanguageModelV3CallOptions, streamedChars: number): LanguageModelV3Usage {
	const serializedInput = `${JSON.stringify(params.prompt) ?? ''}${JSON.stringify(params.tools) ?? ''}`;
	const inputTokens = Math.ceil(serializedInput.length / 4);
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
	if (!rates) {
		throw new Error('Managed model has no configured token pricing.');
	}
	if (context.billingMode === 'unbilled') {
		return;
	}
	if (!context.orgId) {
		throw new Error('Managed AI usage requires a billed organization.');
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
	const costSource: ManagedAiUsageCostSource = options.rates
		? options.status === 'completed'
			? 'price_book'
			: 'estimated'
		: 'unknown';
	const usage = {
		operationId: options.operationId,
		runId: options.context.runId ?? options.operationId,
		userId: options.context.userId,
		orgId: options.context.orgId,
		projectId: options.context.projectId,
		chatId: options.context.chatId,
		chatMessageId: options.context.messageId,
		category: options.context.category,
		llmProvider: 'nao' as const,
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
	};
	if (options.context.billingMode === 'unbilled') {
		await creditWalletService.recordUnbilledManagedAiUsage(usage);
		return;
	}
	const customerChargeMicroUsd = options.status === 'failed' ? 0 : (costs.total ?? 0);
	await creditWalletService.recordManagedAiUsageAndChargeWallet(usage, customerChargeMicroUsd);
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
	const outputTokens = params.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
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

async function hasWalletBalance(projectId: string): Promise<boolean> {
	const project = await projectQueries.getProjectById(projectId);
	return project?.orgId ? (await creditWalletQueries.getCreditBalance(project.orgId)) > 0 : false;
}

function isManagedModel(provider: LlmProvider, modelId: string): boolean {
	return getProviderMeta(provider).models.some((model) => model.id === modelId);
}
