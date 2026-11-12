import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createAgent: vi.fn(),
	createChat: vi.fn(),
	getChat: vi.fn(),
	getProjectAvailableModels: vi.fn(),
	getReferenceableStory: vi.fn(),
	getStoryById: vi.fn(),
	getUserRoleInProject: vi.fn(),
	resolveDefaultChatModel: vi.fn(),
	resolveModelSelection: vi.fn(),
	streamToCompletion: vi.fn(),
}));

vi.mock('../../src/services/agent', () => ({
	agentService: { create: mocks.createAgent, resolveModelSelection: mocks.resolveModelSelection },
}));
vi.mock('../../src/utils/llm', () => ({
	getProjectAvailableModels: mocks.getProjectAvailableModels,
	resolveDefaultChatModel: mocks.resolveDefaultChatModel,
}));
vi.mock('../../src/queries/chat.queries', () => ({
	STORY_MODEL_FORK_TYPE: 'story_model',
	createChat: mocks.createChat,
	getChat: mocks.getChat,
}));
vi.mock('../../src/queries/project.queries', () => ({ getUserRoleInProject: mocks.getUserRoleInProject }));
vi.mock('../../src/queries/story.queries', () => ({ getStoryById: mocks.getStoryById }));
vi.mock('../../src/services/custom-story', () => ({
	CustomStoryNotFoundError: class CustomStoryNotFoundError extends Error {},
}));
vi.mock('../../src/agents/tools', () => ({ getTools: () => ({}) }));
vi.mock('../../src/queries/story-reference.queries', () => ({ getReferenceableStory: mocks.getReferenceableStory }));

import {
	CustomStoryModelError,
	listCustomStoryModels,
	runCustomStoryModel,
} from '../../src/services/custom-story-model';

const TARGET = { projectId: 'project-1', storyId: 'story-1', viewerId: 'viewer-1' };
const AVAILABLE = [
	{ provider: 'anthropic', modelId: 'claude-sonnet', name: 'Claude Sonnet', baseUrl: null },
	{ provider: 'openai', modelId: 'gpt-5', name: 'GPT-5', baseUrl: null },
];
const USER_MESSAGE = { id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'Summarize revenue' }] };

describe('listCustomStoryModels', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectAvailableModels.mockResolvedValue(AVAILABLE);
		mocks.resolveDefaultChatModel.mockResolvedValue({ provider: 'openai', modelId: 'gpt-5' });
		mocks.getUserRoleInProject.mockResolvedValue('user');
	});

	it('lists the project models as llm models, flagging the default chat model', async () => {
		expect(await listCustomStoryModels('project-1', 'viewer-1')).toEqual([
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

	it('lists nothing for members who cannot chat', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		expect(await listCustomStoryModels('project-1', 'viewer-1')).toEqual([]);
	});
});

describe('runCustomStoryModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectAvailableModels.mockResolvedValue(AVAILABLE);
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.resolveModelSelection.mockImplementation(async (_projectId, model) => model ?? AVAILABLE[0]);
		mocks.getReferenceableStory.mockResolvedValue({ title: 'Revenue story', authorName: 'Ada' });
		mocks.getStoryById.mockResolvedValue({ id: 'story-1', format: 'custom', projectId: 'project-1' });
		mocks.createChat.mockResolvedValue([{ id: 'chat-9' }]);
		mocks.getChat.mockResolvedValue([{ id: 'chat-9', title: 'Revenue story', messages: [USER_MESSAGE] }]);
		mocks.createAgent.mockResolvedValue({ streamToCompletion: mocks.streamToCompletion });
		mocks.streamToCompletion.mockResolvedValue({ text: 'Revenue grew.' });
	});

	it('runs through the agent as the viewer, in a chat kept under the story', async () => {
		const result = await runCustomStoryModel(TARGET, {
			kind: 'llm',
			model: 'openai:gpt-5',
			prompt: 'Summarize revenue',
			system: 'Be brief.',
		});

		expect(result).toEqual({ kind: 'llm', model: 'openai:gpt-5', text: 'Revenue grew.' });
		expect(mocks.createChat).toHaveBeenCalledWith(
			{
				projectId: 'project-1',
				userId: 'viewer-1',
				title: 'Revenue story',
				forkMetadata: { type: 'story_model', id: 'story-1', title: 'Revenue story', authorName: 'Ada' },
			},
			{ text: 'Summarize revenue', source: 'storyModel' },
		);
		const [chat, model, profile] = mocks.createAgent.mock.calls[0];
		expect(chat).toMatchObject({ id: 'chat-9', projectId: 'project-1', userId: 'viewer-1' });
		expect(model).toEqual({ provider: 'openai', modelId: 'gpt-5' });
		expect(profile).toMatchObject({
			source: 'storyModel',
			usageCategory: 'story',
			maxSteps: 1,
			maxOutputTokens: 1_024,
		});
		expect(await profile.systemPrompt()).toBe('Be brief.');
		expect(mocks.streamToCompletion).toHaveBeenCalledWith([USER_MESSAGE]);
	});

	it('uses the project default model when the request names none', async () => {
		await runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' });

		expect(mocks.resolveModelSelection).toHaveBeenCalledWith('project-1', undefined);
		expect(mocks.createAgent.mock.calls[0][1]).toEqual(AVAILABLE[0]);
	});

	it('asks the agent for a structured answer when a JSON schema is given', async () => {
		mocks.streamToCompletion.mockResolvedValue({ text: '{"risk":"high"}', output: { risk: 'high' } });

		const result = await runCustomStoryModel(TARGET, {
			kind: 'llm',
			prompt: 'Rate the churn risk',
			schema: { type: 'object', properties: { risk: { type: 'string' } } },
		});

		expect(result).toMatchObject({ object: { risk: 'high' } });
		expect(mocks.createAgent.mock.calls[0][2].output).toBeDefined();
	});

	it('caps the output tokens a story can ask for', async () => {
		await runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi', maxOutputTokens: 1_000_000 });

		expect(mocks.createAgent.mock.calls[0][2].maxOutputTokens).toBe(4_096);
	});

	it('refuses a model the project does not offer, before any chat or call', async () => {
		await expect(
			runCustomStoryModel(TARGET, { kind: 'llm', model: 'openai:not-enabled', prompt: 'Hi' }),
		).rejects.toBeInstanceOf(CustomStoryModelError);
		expect(mocks.createChat).not.toHaveBeenCalled();
		expect(mocks.createAgent).not.toHaveBeenCalled();
	});

	it.each([
		['a classic story', { id: 'story-1', format: 'classic', projectId: 'project-1' }],
		["another project's story", { id: 'story-1', format: 'custom', projectId: 'project-2' }],
		['a missing story', null],
	])('refuses %s before any chat or call', async (_label, story) => {
		mocks.getStoryById.mockResolvedValue(story);

		await expect(runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' })).rejects.toThrow();
		expect(mocks.createChat).not.toHaveBeenCalled();
		expect(mocks.createAgent).not.toHaveBeenCalled();
	});

	it('refuses members who cannot chat, like the chat does', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		await expect(runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' })).rejects.toThrow(
			'Viewers cannot perform this action',
		);
		expect(mocks.createAgent).not.toHaveBeenCalled();
	});

	it('lets budget and billing refusals from the agent keep their own error', async () => {
		const budgetError = new Error('Your monthly budget is exhausted.');
		mocks.createAgent.mockRejectedValue(budgetError);

		await expect(runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' })).rejects.toBe(budgetError);
	});

	it('surfaces a failing model run as a story error', async () => {
		mocks.streamToCompletion.mockRejectedValue(new Error('Provider overloaded.'));

		await expect(runCustomStoryModel(TARGET, { kind: 'llm', prompt: 'Hi' })).rejects.toThrow(
			new CustomStoryModelError('Provider overloaded.'),
		);
	});
});
