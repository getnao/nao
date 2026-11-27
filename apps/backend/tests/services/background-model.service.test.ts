import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HandlerError } from '../../src/utils/error';

const mocks = vi.hoisted(() => ({
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
	resolveUserBackgroundModelSelection: vi.fn(),
	resolveUserBackgroundModelId: vi.fn(),
}));

vi.mock('../../src/utils/llm', () => ({
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelection,
	resolveProviderModel: mocks.resolveProviderModel,
}));

vi.mock('../../src/services/user-group-llm-access.service', () => ({
	resolveUserBackgroundModelSelection: mocks.resolveUserBackgroundModelSelection,
	resolveUserBackgroundModelId: mocks.resolveUserBackgroundModelId,
}));

import { resolveUserBackgroundModel } from '../../src/services/background-model.service';

const usageContext = { userId: 'user-1', projectId: 'project-1', category: 'title' as const };
const granted = { provider: 'openai' as const, modelId: 'gpt-5', llmConfigId: 'credential-1' };

describe('resolveUserBackgroundModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveDefaultModelSelection.mockResolvedValue(null);
		mocks.resolveUserBackgroundModelSelection.mockResolvedValue(granted);
		mocks.resolveUserBackgroundModelId.mockImplementation(async (_p, _u, _s, preferred: string) => preferred);
		mocks.resolveProviderModel.mockImplementation(async (_p, _provider, modelId: string) => ({ modelId }));
	});

	it('runs the preferred model on the granted credential when nothing is pinned', async () => {
		const result = await resolveUserBackgroundModel({
			projectId: 'project-1',
			userId: 'user-1',
			defaultCategory: 'title',
			fallback: { provider: 'openai', modelId: 'gpt-5' },
			preferredModelId: () => 'gpt-5-mini',
			usageContext,
		});

		expect(mocks.resolveUserBackgroundModelSelection).toHaveBeenCalledWith('project-1', 'user-1', {
			provider: 'openai',
			modelId: 'gpt-5',
		});
		expect(mocks.resolveProviderModel).toHaveBeenCalledWith(
			'project-1',
			'openai',
			'gpt-5-mini',
			false,
			usageContext,
			undefined,
			'credential-1',
		);
		expect(result).toMatchObject({ provider: 'openai', modelId: 'gpt-5-mini', llmConfigId: 'credential-1' });
	});

	it('keeps the pinned model over the fallback and the preferred model', async () => {
		const pinned = { provider: 'anthropic' as const, modelId: 'claude-opus-5-5' };
		mocks.resolveDefaultModelSelection.mockResolvedValue(pinned);
		mocks.resolveUserBackgroundModelSelection.mockResolvedValue(pinned);

		const result = await resolveUserBackgroundModel({
			projectId: 'project-1',
			userId: 'user-1',
			defaultCategory: 'title',
			fallback: granted,
			preferredModelId: () => 'claude-haiku-5-5',
			usageContext,
		});

		expect(mocks.resolveUserBackgroundModelSelection).toHaveBeenCalledWith('project-1', 'user-1', pinned);
		expect(mocks.resolveUserBackgroundModelId).not.toHaveBeenCalled();
		expect(result?.modelId).toBe('claude-opus-5-5');
	});

	it('returns null when the user has no model to run it on', async () => {
		mocks.resolveUserBackgroundModelSelection.mockRejectedValue(
			new HandlerError('BAD_REQUEST', 'No model is available for this user.'),
		);

		const result = await resolveUserBackgroundModel({ projectId: 'project-1', userId: 'user-1', usageContext });

		expect(result).toBeNull();
		expect(mocks.resolveProviderModel).not.toHaveBeenCalled();
	});
});
