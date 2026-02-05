import { z } from 'zod';

import { llmProviderSchema } from './llm';

export const granularitySchema = z.enum(['hour', 'day', 'month']);
export type Granularity = z.infer<typeof granularitySchema>;

export const usageFilterSchema = z.object({
	granularity: granularitySchema.default('day'),
	provider: llmProviderSchema.optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export interface UsageRecord {
	date: string;
	nbMessages: number;
	inputNoCacheTokens: number;
	inputCacheReadTokens: number;
	inputCacheWriteTokens: number;
	outputTotalTokens: number;
	totalTokens: number;
	// Cost in USD (calculated from token usage and model pricing)
	inputNoCacheCost: number;
	inputCacheReadCost: number;
	inputCacheWriteCost: number;
	outputCost: number;
	totalCost: number;
}
