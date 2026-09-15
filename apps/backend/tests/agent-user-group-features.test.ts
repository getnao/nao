import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getEffectiveUserGroupFeatureFlags: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	createStoryVersion: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/services/user-group-feature-access.service', () => ({
	getEffectiveUserGroupFeatureFlags: mocks.getEffectiveUserGroupFeatureFlags,
}));
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
import { appendUserGroupRestrictions, isStoryCreationRestricted, shouldAddStoryMode } from '../src/services/agent';
import type { ToolContext } from '../src/types/tools';

describe('agent user group feature tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps Story available after resolving tools when creation is denied', () => {
		const tools = { story: { custom: true }, execute_sql: {}, custom: {} };

		expect(isStoryCreationRestricted(tools as never, false)).toBe(true);
		expect(tools.story).toEqual({ custom: true });
	});

	it('adds Story and Automation restrictions under one heading', () => {
		const tools = { story: {}, execute_sql: {} };
		const prompt = appendUserGroupRestrictions('Custom project prompt', {
			storyCreation: isStoryCreationRestricted(tools as never, false),
			automationCreation: true,
		});

		expect(prompt).toContain('Custom project prompt');
		expect(prompt).toContain('## User group permissions');
		expect(prompt).toContain('Do not attempt or offer to create a new Story');
		expect(prompt).toContain('You may update or replace existing Stories');
		expect(prompt).toContain('Automation creation is unavailable');
		expect(prompt).toContain('user can still view and manage existing Automations');
		expect(prompt.match(/## User group permissions/g)).toHaveLength(1);
		expect(isStoryCreationRestricted({ execute_sql: {} } as never, false)).toBe(false);
	});

	it('omits restrictions that are allowed or unavailable in the candidate tools', () => {
		expect(
			appendUserGroupRestrictions('Allowed prompt', {
				storyCreation: false,
				automationCreation: false,
			}),
		).toBe('Allowed prompt');

		const automationOnly = appendUserGroupRestrictions('Prompt', {
			storyCreation: isStoryCreationRestricted({ execute_sql: {} } as never, false),
			automationCreation: true,
		});
		expect(automationOnly).not.toContain('Story creation through the agent is unavailable');
		expect(automationOnly).toContain('Automation creation is unavailable');
	});

	it('suppresses stale Story-mode mentions while restricted', () => {
		const mentions = [{ id: '__story__', label: 'Story mode', trigger: '#' }];

		expect(shouldAddStoryMode(mentions, false)).toBe(false);
		expect(shouldAddStoryMode(mentions, true)).toBe(true);
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
		storyCreationEnabled,
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	} as unknown as ToolContext;

	return storyTool.execute!(input, {
		toolCallId: 'tool-call-id',
		messages: [],
		experimental_context: context,
	});
}
