import { beforeEach, describe, expect, it, vi } from 'vitest';

import { naturalLanguageToCron } from '../src/services/cron-nlp';
import { sanitizeCron } from '../src/utils/cron';
import { ManagedCreditsExhaustedError } from '../src/utils/error';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	getProjectModelProvider: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
}));

vi.mock('ai', () => ({
	generateText: mocks.generateText,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectModelProvider: mocks.getProjectModelProvider,
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: vi.fn(),
}));

vi.mock('../src/utils/llm', () => ({
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelection,
	resolveProviderModel: mocks.resolveProviderModel,
}));

describe('naturalLanguageToCron', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectModelProvider.mockResolvedValue('nao');
		mocks.resolveDefaultModelSelection.mockResolvedValue(null);
		mocks.resolveProviderModel.mockResolvedValue({
			model: { modelId: 'gpt-6-luna' },
			providerOptions: { openai: {} },
			contextWindow: 400_000,
		});
	});

	it('rethrows managed credit exhaustion', async () => {
		const error = new ManagedCreditsExhaustedError();
		mocks.generateText.mockRejectedValue(error);

		await expect(naturalLanguageToCron('project-1', 'user-1', 'every hour')).rejects.toBe(error);
	});
});

describe('sanitizeCron', () => {
	it('keeps a bare expression as it is', () => {
		expect(sanitizeCron('0 8 * * *')).toBe('0 8 * * *');
	});

	it('drops the backticks around an inline expression', () => {
		expect(sanitizeCron('`0 8 * * *`')).toBe('0 8 * * *');
	});

	it('drops a fenced block', () => {
		expect(sanitizeCron('```\n0 8 * * *\n```')).toBe('0 8 * * *');
	});

	it('drops the language tag of a fenced block', () => {
		expect(sanitizeCron('```cron\n0 8 * * *\n```')).toBe('0 8 * * *');
	});

	it('drops the whitespace surrounding a fenced block', () => {
		expect(sanitizeCron('  ```bash\n*/15 9-17 * * 1-5\n```  ')).toBe('*/15 9-17 * * 1-5');
	});

	it('returns nothing for an empty answer', () => {
		expect(sanitizeCron('```\n\n```')).toBe('');
	});
});
