import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	createStoryVersion: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	createStoryVersion: mocks.createStoryVersion,
}));
vi.mock('../src/queries/chart-image', () => ({
	getDisplayChartTableFormatsForChat: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/queries/story-folder.queries', () => ({
	saveStoryInPrivateRoot: vi.fn(),
}));
vi.mock('../src/services/story-template-validation', () => ({
	getStoryTemplateWarnings: vi.fn().mockResolvedValue([]),
}));

import storyTool from '../src/agents/tools/story';
import { shouldAddStoryMode } from '../src/services/agent';
import { resolveAgentUserGroupAccess } from '../src/services/user-group-feature-access.service';
import type { ToolContext } from '../src/types/tools';

describe('agent user group feature tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('suppresses stale Story-mode mentions while restricted', () => {
		const mentions = [{ id: '__story__', label: 'Story mode', trigger: '#' }];
		const restrictedAccess = resolveAgentUserGroupAccess([], { story: {} });
		const allowedAccess = resolveAgentUserGroupAccess(['storyCreation'], { story: {} });

		expect(shouldAddStoryMode(mentions, restrictedAccess)).toBe(false);
		expect(shouldAddStoryMode(mentions, allowedAccess)).toBe(true);
	});

	it('rejects restricted Story creation before accessing persistence', async () => {
		const output = await executeStory(
			{ action: 'create', id: 'new-story', title: 'New Story', code: '# New' },
			false,
		);

		expect(output).toMatchObject({
			success: false,
			id: 'new-story',
			error: 'Story creation is unavailable for this user in this project.',
		});
		expect(mocks.getStoryByChatAndSlug).not.toHaveBeenCalled();
		expect(mocks.createStoryVersion).not.toHaveBeenCalled();
	});

	it.each([
		{
			action: 'update' as const,
			input: { search: 'Old', replace: 'Updated' },
			expectedCode: '# Updated',
		},
		{
			action: 'replace' as const,
			input: { code: '# Replaced' },
			expectedCode: '# Replaced',
		},
	])('allows restricted users to run Story $action', async ({ action, input, expectedCode }) => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '# Old',
			version: 1,
			title: 'Existing Story',
		});
		mocks.createStoryVersion.mockImplementation(async (values) => ({ ...values, version: 2 }));

		const output = await executeStory({ action, id: 'existing-story', ...input }, false);

		expect(output).toMatchObject({ success: true, code: expectedCode, version: 2 });
		expect(mocks.createStoryVersion).toHaveBeenCalledWith(
			expect.objectContaining({ action, slug: 'existing-story', code: expectedCode }),
		);
	});
});

async function executeStory(
	input: Parameters<NonNullable<typeof storyTool.execute>>[0],
	storyCreationEnabled: boolean,
) {
	const context = {
		chatId: 'chat-id',
		userId: 'user-id',
		projectId: 'project-id',
		userGroupFeatures: storyCreationEnabled ? ['storyCreation'] : [],
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	} as unknown as ToolContext;

	return storyTool.execute!(input, {
		toolCallId: 'tool-call-id',
		messages: [],
		experimental_context: context,
	});
}
