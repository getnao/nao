import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateContextCommitMessage, sanitizeCommitMessage } from '../../src/services/context-commit-message.service';
import type { ContextExplorerGitContext } from '../../src/services/context-explorer-git/types';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	readContextChangesPatch: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
	resolveUserBackgroundModelSelection: vi.fn(),
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('../../src/services/context-explorer-git.service', () => ({
	readContextChangesPatch: mocks.readContextChangesPatch,
}));
vi.mock('../../src/services/user-group-llm-access.service', () => ({
	resolveUserBackgroundModelSelection: mocks.resolveUserBackgroundModelSelection,
	resolveUserBackgroundModelId: vi.fn(
		async (_projectId: string, _userId: string, _selection: unknown, preferredModelId: string) => preferredModelId,
	),
}));
vi.mock('../../src/utils/llm', () => ({
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelection,
	resolveProviderModel: mocks.resolveProviderModel,
}));

const gitContext: ContextExplorerGitContext = {
	projectId: 'project-1',
	projectFolder: '/project',
	userId: 'user-1',
	user: { name: 'Ada', email: 'ada@example.com' },
	token: null,
};

describe('generateContextCommitMessage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.readContextChangesPatch.mockResolvedValue('diff --git a/rules.md b/rules.md');
		mocks.resolveDefaultModelSelection.mockResolvedValue({ provider: 'openai', modelId: 'gpt-5' });
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'gpt-5' }, providerOptions: { openai: {} } });
		mocks.generateText.mockResolvedValue({ text: 'Document refunds' });
	});

	it('uses the credential granted to the requesting user', async () => {
		mocks.resolveUserBackgroundModelSelection.mockResolvedValue({
			provider: 'openai',
			modelId: 'gpt-5',
			llmConfigId: 'granted-credential',
		});

		await generateContextCommitMessage(gitContext, ['rules.md']);

		expect(mocks.resolveUserBackgroundModelSelection).toHaveBeenCalledWith('project-1', 'user-1', {
			provider: 'openai',
			modelId: 'gpt-5',
		});
		expect(mocks.resolveProviderModel).toHaveBeenCalledWith(
			'project-1',
			'openai',
			'gpt-5',
			false,
			expect.objectContaining({ userId: 'user-1' }),
			undefined,
			'granted-credential',
		);
	});
});

describe('sanitizeCommitMessage', () => {
	it.each([
		{ text: 'Document net revenue on orders', expected: 'Document net revenue on orders' },
		{ text: '"Document net revenue on orders."', expected: 'Document net revenue on orders' },
		{ text: 'Document refunds\n\nThe orders table now explains refunds.', expected: 'Document refunds' },
		{ text: `  ${'x'.repeat(200)}  `, expected: 'x'.repeat(120) },
	])('keeps one clean line from $text', ({ text, expected }) => {
		expect(sanitizeCommitMessage(text)).toBe(expected);
	});
});
