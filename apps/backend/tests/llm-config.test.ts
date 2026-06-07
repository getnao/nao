import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DBProjectLlmConfig } from '../src/db/abstractSchema';
import * as projectLlmConfigQueries from '../src/queries/project-llm-config.queries';
import { inferenceParamsSchema } from '../src/types/llm';
import { resolveProviderModel } from '../src/utils/llm';

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: vi.fn(),
}));

describe('inferenceParamsSchema', () => {
	it('should accept valid inference parameters', () => {
		const valid = {
			temperature: 0.7,
			topP: 0.9,
			maxTokens: 1024,
			extras: {
				frequency_penalty: 0.5,
				presence_penalty: 0.5,
			},
		};
		const result = inferenceParamsSchema.safeParse(valid);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(valid);
		}
	});

	it('should accept empty inference parameters', () => {
		const result = inferenceParamsSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('should reject invalid temperature', () => {
		const invalid = { temperature: 2.5 };
		const result = inferenceParamsSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});

	it('should reject invalid topP', () => {
		const invalid = { topP: -0.1 };
		const result = inferenceParamsSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});

	it('should reject negative maxTokens', () => {
		const invalid = { maxTokens: -100 };
		const result = inferenceParamsSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});
});

describe('resolveProviderModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should attach inferenceParams when present in database config', async () => {
		const mockConfig = {
			id: 'config-1',
			projectId: 'proj-123',
			provider: 'openai',
			apiKey: 'sk-mock-key',
			baseUrl: 'https://api.openai.com/v1',
			inferenceParams: {
				temperature: 0.2,
				topP: 0.8,
				maxTokens: 2048,
				extras: { custom_param: 'value' },
			},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		vi.mocked(projectLlmConfigQueries.getProjectLlmConfigByProvider).mockResolvedValue(
			mockConfig as unknown as DBProjectLlmConfig,
		);

		const result = await resolveProviderModel('proj-123', 'openai', 'gpt-4o');

		expect(result).not.toBeNull();
		expect(result?.inferenceParams).toEqual({
			temperature: 0.2,
			topP: 0.8,
			maxTokens: 2048,
			extras: { custom_param: 'value' },
		});
	});

	it('should handle config with null inferenceParams', async () => {
		const mockConfig = {
			id: 'config-2',
			projectId: 'proj-123',
			provider: 'openai',
			apiKey: 'sk-mock-key',
			baseUrl: null,
			inferenceParams: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		vi.mocked(projectLlmConfigQueries.getProjectLlmConfigByProvider).mockResolvedValue(
			mockConfig as unknown as DBProjectLlmConfig,
		);

		const result = await resolveProviderModel('proj-123', 'openai', 'gpt-4o');

		expect(result).not.toBeNull();
		expect(result?.inferenceParams).toBeUndefined();
	});
});
