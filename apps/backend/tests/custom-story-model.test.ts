import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertRunAvailable: vi.fn(),
	generateText: vi.fn(),
	getProjectAvailableModels: vi.fn(),
	resolveDefaultChatModel: vi.fn(),
	resolveProviderModel: vi.fn(),
	scheduleSaveLlmInferenceRecord: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	generateText: mocks.generateText,
}));
vi.mock('../src/services/agent', () => ({ agentService: { assertRunAvailable: mocks.assertRunAvailable } }));
vi.mock('../src/utils/llm', () => ({
	getProjectAvailableModels: mocks.getProjectAvailableModels,
	resolveDefaultChatModel: mocks.resolveDefaultChatModel,
	resolveProviderModel: mocks.resolveProviderModel,
}));
vi.mock('../src/utils/schedule-task', () => ({
	scheduleSaveLlmInferenceRecord: mocks.scheduleSaveLlmInferenceRecord,
}));
vi.mock('../src/agents/telemetry', () => ({ llmTelemetry: () => undefined }));
vi.mock('../src/utils/ai', () => ({ convertToTokenUsage: () => ({ totalTokens: 15 }) }));

import { CustomStoryModelError, listCustomStoryModels, runCustomStoryModel } from '../src/services/custom-story-model';

const TARGET = { projectId: 'project-1', chatId: 'chat-1', viewerId: 'viewer-1' };
const AVAILABLE = [
	{ provider: 'anthropic', modelId: 'claude-sonnet', name: 'Claude Sonnet', baseUrl: null },
	{ provider: 'openai', modelId: 'gpt-5', name: 'GPT-5', baseUrl: null },
];
const USAGE = { totalTokens: 15 };

describe('listCustomStoryModels', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectAvailableModels.mockResolvedValue(AVAILABLE);
	});

	it('lists the project models as llm models, flagging the default chat model', async () => {
		mocks.resolveDefaultChatModel.mockResolvedValue({ provider: 'openai', modelId: 'gpt-5' });

		expect(await listCustomStoryModels('project-1')).toEqual([
			{
				kind: 'llm',
				id: 'anthropic:claude-sonnet',
				provider: 'anthropic',
				modelId: 'claude-sonnet',
				name: 'Claude Sonnet',
				isDefault: false,
			},
			{ kind: 'llm', id: 'openai:gpt-5', provider: 'openai', modelId: 'gpt-5', name: 'GPT-5', isDefault: true },
		]);
	});
});

describe('runCustomStoryModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectAvailableModels.mockResolvedValue(AVAILABLE);
		mocks.assertRunAvailable.mockImplementation(async (_projectId, model) => model ?? AVAILABLE[0]);
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'resolved' } });
		mocks.generateText.mockResolvedValue({ text: 'Revenue grew.', usage: USAGE });
	});

	it('calls the requested model as the viewer, under their budget, and records the usage to them', async () => {
		const result = await runCustomStoryModel(TARGET, {
			kind: 'llm',
			model: 'openai:gpt-5',
			prompt: 'Summarize revenue',
			system: 'Be brief.',
		});

		expect(result).toEqual({ kind: 'llm', model: 'openai:gpt-5', text: 'Revenue grew.' });
		expect(mocks.assertRunAvailable).toHaveBeenCalledWith(
			'project-1',
			{ provider: 'openai', modelId: 'gpt-5' },
			'viewer-1',
		);
		expect(mocks.resolveProviderModel).toHaveBeenCalledWith('project-1', 'openai', 'gpt-5', true, {
			userId: 'viewer-1',
			projectId: 'project-1',
			chatId: 'chat-1',
			category: 'story',
		});
		expect(mocks.generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				system: 'Be brief.',
				messages: [{ role: 'user', content: 'Summarize revenue' }],
				maxOutputTokens: 1_024,
			}),
		);
		expect(mocks.scheduleSaveLlmInferenceRecord).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'custom_story_model', userId: 'viewer-1', llmModelId: 'gpt-5' }),
		);
	});

	it('uses the project default model when the request names none', async () => {
		await runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' });

		expect(mocks.assertRunAvailable).toHaveBeenCalledWith('project-1', undefined, 'viewer-1');
	});

	it('answers with an object when a JSON schema is given', async () => {
		mocks.generateText.mockResolvedValue({ text: '{"risk":"high"}', output: { risk: 'high' }, usage: USAGE });

		const result = await runCustomStoryModel(TARGET, {
			kind: 'llm',
			prompt: 'Rate the churn risk',
			schema: { type: 'object', properties: { risk: { type: 'string' } } },
		});

		expect(result).toMatchObject({ object: { risk: 'high' } });
		expect(mocks.generateText.mock.calls[0][0]).toHaveProperty('output');
	});

	it('refuses a model the project does not offer, before any call', async () => {
		await expect(
			runCustomStoryModel(TARGET, { kind: 'llm', model: 'openai:not-enabled', prompt: 'Hi' }),
		).rejects.toBeInstanceOf(CustomStoryModelError);
		expect(mocks.assertRunAvailable).not.toHaveBeenCalled();
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('caps the output tokens a story can ask for', async () => {
		await runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi', maxOutputTokens: 1_000_000 });

		expect(mocks.generateText.mock.calls[0][0].maxOutputTokens).toBe(4_096);
	});

	it('surfaces an exhausted budget as a story error, without calling the model', async () => {
		mocks.assertRunAvailable.mockRejectedValue(new Error('Your monthly budget is exhausted.'));

		await expect(runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' })).rejects.toThrow(
			new CustomStoryModelError('Your monthly budget is exhausted.'),
		);
		expect(mocks.generateText).not.toHaveBeenCalled();
	});
});
