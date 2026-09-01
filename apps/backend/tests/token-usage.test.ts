import { describe, expect, it } from 'vitest';

import type { TokenUsage } from '../src/types/chat';
import { addTokenUsage } from '../src/utils/ai';

describe('addTokenUsage', () => {
	it('sums cache categories across verification attempts', () => {
		const first: TokenUsage = {
			inputTotalTokens: 100,
			inputNoCacheTokens: 60,
			inputCacheReadTokens: 30,
			inputCacheWriteTokens: 10,
			outputTotalTokens: 20,
			outputTextTokens: 15,
			outputReasoningTokens: 5,
			totalTokens: 120,
		};
		const repair: TokenUsage = {
			inputTotalTokens: 80,
			inputNoCacheTokens: undefined,
			inputCacheReadTokens: 80,
			inputCacheWriteTokens: 0,
			outputTotalTokens: 10,
			outputTextTokens: 10,
			outputReasoningTokens: undefined,
			totalTokens: 90,
		};

		expect(addTokenUsage(first, repair)).toEqual({
			inputTotalTokens: 180,
			inputNoCacheTokens: 60,
			inputCacheReadTokens: 110,
			inputCacheWriteTokens: 10,
			outputTotalTokens: 30,
			outputTextTokens: 25,
			outputReasoningTokens: 5,
			totalTokens: 210,
		});
	});

	it('preserves missing categories and accepts no attempts', () => {
		expect(addTokenUsage()).toBeUndefined();
		expect(
			addTokenUsage({
				inputTotalTokens: undefined,
				inputNoCacheTokens: undefined,
				inputCacheReadTokens: undefined,
				inputCacheWriteTokens: undefined,
				outputTotalTokens: 3,
				outputTextTokens: undefined,
				outputReasoningTokens: undefined,
				totalTokens: 3,
			}),
		).toMatchObject({ inputNoCacheTokens: undefined, outputTotalTokens: 3 });
	});
});
