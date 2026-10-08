import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactsPrompt } from '../src/components/ai/chat-artifacts-prompt';
import type { StoryModelOutput } from '../src/components/tool-outputs/story';
import { StoryOutput } from '../src/components/tool-outputs/story';
import { renderToMarkdown } from '../src/lib/markdown';
import {
	appendChatArtifacts,
	collapseStoryToolOutputs,
	collectQueryArtifacts,
	getChatArtifacts,
	hasChatArtifacts,
	safeGetChatArtifacts,
} from '../src/services/chat-artifacts';
import type { ChatArtifacts } from '../src/types/artifacts';
import type { UIMessage, UIMessagePart } from '../src/types/chat';

const mocks = vi.hoisted(() => ({
	listLatestVersionsInChat: vi.fn(),
	listDraftFiles: vi.fn(),
	getStoryTemplateWarnings: vi.fn(),
}));

vi.mock('../src/queries/story.queries', () => ({
	listLatestVersionsInChat: mocks.listLatestVersionsInChat,
}));

vi.mock('../src/queries/story-file.queries', () => ({
	listDraftFiles: mocks.listDraftFiles,
}));

vi.mock('../src/services/story-template-validation', () => ({
	getStoryTemplateWarnings: mocks.getStoryTemplateWarnings,
}));

const STORY_CODE = '# Revenue\n\n<chart query_id="query_aaaa1111" chart_type="line" x_axis_key="month" />\n';

function executeSqlPart(id: string, name: string | undefined, columns: string[], rowCount: number): UIMessagePart {
	return {
		type: 'tool-execute_sql',
		toolCallId: `call_${id}_${rowCount}`,
		state: 'output-available',
		input: { sql_query: 'SELECT 1', name },
		output: { _version: '1', id, columns, row_count: rowCount, data: [] },
	} as unknown as UIMessagePart;
}

function storyPart(id: string, title: string, version: number, code: string): UIMessagePart {
	return {
		type: 'tool-story',
		toolCallId: `call_story_${id}_${version}`,
		state: 'output-available',
		input: { action: 'create', id, title, code },
		output: { _version: '1', success: true, id, version, code, title },
	} as unknown as UIMessagePart;
}

function withStoryId(artifacts: ChatArtifacts, id: string): ChatArtifacts {
	return { ...artifacts, stories: artifacts.stories.map((story) => ({ ...story, id })) };
}

function assistant(id: string, ...parts: UIMessagePart[]): UIMessage {
	return { id, role: 'assistant', parts };
}

function user(id: string, text: string): UIMessage {
	return { id, role: 'user', parts: [{ type: 'text', text }] };
}

describe('collectQueryArtifacts', () => {
	it('lists each query once, in order of first appearance, with the columns of its latest run', () => {
		const messages = [
			user('u1', 'Revenue?'),
			assistant('a1', executeSqlPart('query_aaaa1111', 'Monthly revenue', ['month', 'revenue'], 12)),
			user('u2', 'Top customers?'),
			assistant('a2', executeSqlPart('query_bbbb2222', undefined, ['customer', 'revenue'], 5)),
			user('u3', 'Add the order count to the revenue query'),
			assistant('a3', executeSqlPart('query_aaaa1111', 'Monthly revenue', ['month', 'revenue', 'orders'], 12)),
		];

		expect(collectQueryArtifacts(messages)).toEqual([
			{ id: 'query_aaaa1111', title: 'Monthly revenue', columns: ['month', 'revenue', 'orders'], rowCount: 12 },
			{ id: 'query_bbbb2222', title: undefined, columns: ['customer', 'revenue'], rowCount: 5 },
		]);
	});

	it('ignores queries that have not settled or failed', () => {
		const pending = {
			type: 'tool-execute_sql',
			toolCallId: 'call_pending',
			state: 'input-available',
			input: { sql_query: 'SELECT 1' },
		} as unknown as UIMessagePart;
		const failed = {
			type: 'tool-execute_sql',
			toolCallId: 'call_failed',
			state: 'output-error',
			input: { sql_query: 'SELECT 1' },
			errorText: 'boom',
		} as unknown as UIMessagePart;

		expect(collectQueryArtifacts([assistant('a1', pending, failed)])).toEqual([]);
	});
});

describe('getChatArtifacts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listLatestVersionsInChat.mockResolvedValue([]);
		mocks.listDraftFiles.mockResolvedValue([]);
		mocks.getStoryTemplateWarnings.mockResolvedValue([]);
	});

	it('takes stories from the database at their latest version, flagging user edits and template warnings', async () => {
		mocks.listLatestVersionsInChat.mockResolvedValue([
			{
				storyId: 'story-1',
				slug: 'revenue',
				title: 'Revenue (edited)',
				format: 'classic',
				archivedAt: null,
				version: 3,
				code: STORY_CODE,
				source: 'user',
			},
		]);
		mocks.getStoryTemplateWarnings.mockResolvedValue(['Story references query_id "query_aaaa1111" ...']);

		const artifacts = await getChatArtifacts('chat-1', [
			user('u1', 'Make a story'),
			assistant('a1', storyPart('revenue', 'Revenue', 1, '# old version')),
		]);

		expect(mocks.listLatestVersionsInChat).toHaveBeenCalledWith('chat-1');
		expect(mocks.getStoryTemplateWarnings).toHaveBeenCalledWith('chat-1', STORY_CODE);
		expect(artifacts.stories).toEqual([
			{
				id: 'revenue',
				title: 'Revenue (edited)',
				version: 3,
				format: 'classic',
				code: STORY_CODE,
				files: [],
				editedByUser: true,
				templateWarnings: ['Story references query_id "query_aaaa1111" ...'],
			},
		]);
	});

	it('lists the draft files of a custom story, even before its first publication', async () => {
		mocks.listLatestVersionsInChat.mockResolvedValue([
			{
				storyId: 'story-2',
				slug: 'churn-app',
				title: 'Churn app',
				format: 'custom',
				archivedAt: null,
				version: null,
				code: null,
				source: null,
			},
		]);
		mocks.listDraftFiles.mockResolvedValue([{ path: 'app.jsx' }, { path: 'nao.json' }]);

		const artifacts = await getChatArtifacts('chat-1', []);

		expect(mocks.listDraftFiles).toHaveBeenCalledWith('story-2');
		expect(mocks.getStoryTemplateWarnings).not.toHaveBeenCalled();
		expect(artifacts.stories).toEqual([
			{
				id: 'churn-app',
				title: 'Churn app',
				version: 0,
				format: 'custom',
				code: '',
				files: ['app.jsx', 'nao.json'],
				editedByUser: false,
				templateWarnings: [],
			},
		]);
	});

	it('keeps a story pinned by a fork from its tool output when the chat does not store it', async () => {
		mocks.listLatestVersionsInChat.mockResolvedValue([
			{
				storyId: 'story-1',
				slug: 'revenue',
				title: 'Revenue',
				format: 'classic',
				archivedAt: null,
				version: 2,
				code: STORY_CODE,
				source: 'assistant',
			},
		]);

		const artifacts = await getChatArtifacts('chat-1', [
			assistant('pinned', storyPart('source-story', 'Source story', 4, '# From another chat')),
			assistant('a1', storyPart('revenue', 'Revenue', 1, '# old version')),
		]);

		expect(artifacts.stories.map((story) => [story.id, story.version, story.code])).toEqual([
			['revenue', 2, STORY_CODE],
			['source-story', 4, '# From another chat'],
		]);
	});

	it('leaves an archived story out, even when its tool output is still in the history', async () => {
		mocks.listLatestVersionsInChat.mockResolvedValue([
			{
				storyId: 'story-1',
				slug: 'revenue',
				title: 'Revenue',
				format: 'classic',
				archivedAt: new Date('2026-10-01'),
				version: 2,
				code: STORY_CODE,
				source: 'assistant',
			},
		]);

		const artifacts = await getChatArtifacts('chat-1', [
			assistant('a1', storyPart('revenue', 'Revenue', 1, '# old version')),
		]);

		expect(artifacts.stories).toEqual([]);
		expect(mocks.getStoryTemplateWarnings).not.toHaveBeenCalled();
	});

	it('is empty for a conversation without queries or stories', async () => {
		const artifacts = await getChatArtifacts('chat-1', [user('u1', 'Hello')]);

		expect(artifacts).toEqual({ queries: [], stories: [] });
		expect(hasChatArtifacts(artifacts)).toBe(false);
	});
});

describe('collapseStoryToolOutputs', () => {
	const liveArtifacts: ChatArtifacts = {
		queries: [],
		stories: [
			{
				id: 'revenue',
				title: 'Revenue',
				version: 2,
				format: 'classic',
				code: STORY_CODE,
				files: [],
				editedByUser: false,
				templateWarnings: [],
			},
		],
	};

	it('empties every story output and points live ones to the artifacts block', () => {
		const [message] = collapseStoryToolOutputs(
			[assistant('a1', storyPart('revenue', 'Revenue', 1, '# v1'))],
			liveArtifacts,
		);
		const output = (message.parts[0] as { output: StoryModelOutput }).output;

		expect(output).toMatchObject({ _stale: true, _archived: false, code: '' });
		expect(renderToMarkdown(StoryOutput({ output }))).toContain('<conversation-artifacts> block');
	});

	it('marks the output of a story missing from the artifacts as archived', () => {
		const [message] = collapseStoryToolOutputs([assistant('a1', storyPart('revenue', 'Revenue', 1, '# v1'))], {
			queries: [],
			stories: [],
		});
		const output = (message.parts[0] as { output: StoryModelOutput }).output;

		expect(output).toMatchObject({ _stale: true, _archived: true, code: '' });
		const rendered = renderToMarkdown(StoryOutput({ output }));
		expect(rendered).toContain('has since been archived');
		expect(rendered).not.toContain('<conversation-artifacts>');
	});
});

describe('appendChatArtifacts', () => {
	it('adds the block to the last user message only when there is something to carry', () => {
		const messages = [user('u1', 'First'), assistant('a1'), user('u2', 'Second')];
		const artifacts: ChatArtifacts = {
			queries: [{ id: 'query_aaaa1111', columns: ['total'], rowCount: 1 }],
			stories: [],
		};

		const appended = appendChatArtifacts(messages, artifacts);
		expect(appended[2].parts).toHaveLength(2);
		expect(appended[0].parts).toHaveLength(1);
		expect(appendChatArtifacts(messages, { queries: [], stories: [] })).toBe(messages);
	});
});

describe('safeGetChatArtifacts', () => {
	it('returns undefined instead of failing when the stories cannot be loaded', async () => {
		mocks.listLatestVersionsInChat.mockRejectedValue(new Error('db down'));

		await expect(safeGetChatArtifacts('chat-1', [user('u1', 'Hello')])).resolves.toBeUndefined();
	});
});

describe('ChatArtifactsPrompt', () => {
	const artifacts: ChatArtifacts = {
		queries: [
			{ id: 'query_aaaa1111', title: 'Monthly revenue', columns: ['month', 'revenue'], rowCount: 12 },
			{ id: 'query_bbbb2222', columns: ['total'], rowCount: 1 },
		],
		stories: [
			{
				id: 'revenue',
				title: 'Revenue "2025"',
				version: 3,
				format: 'classic',
				code: STORY_CODE,
				files: [],
				editedByUser: true,
				templateWarnings: [],
			},
		],
	};

	it('renders the exact ids and the story code verbatim inside a tagged block', () => {
		const rendered = renderToMarkdown(ChatArtifactsPrompt({ artifacts }));

		expect(rendered.startsWith('<conversation-artifacts>')).toBe(true);
		expect(rendered.trimEnd().endsWith('</conversation-artifacts>')).toBe(true);
		expect(rendered).toContain('- query_aaaa1111 — Monthly revenue — 12 rows — columns: ["month","revenue"]');
		expect(rendered).toContain('- query_bbbb2222 — 1 row — columns: ["total"]');
		expect(rendered).toContain('<story id="revenue" title="Revenue \\"2025\\"" version="3" format="classic">');
		expect(renderToMarkdown(ChatArtifactsPrompt({ artifacts: withStoryId(artifacts, 'x" evil="y') }))).toContain(
			'<story id="x\\" evil=\\"y" title=',
		);
		expect(rendered).toContain(`\n${STORY_CODE}\n</story>`);
		expect(rendered).toContain('the user modified this story since your last update');
	});

	it('omits the section of an artifact kind the conversation has none of', () => {
		const rendered = renderToMarkdown(ChatArtifactsPrompt({ artifacts: { ...artifacts, stories: [] } }));

		expect(rendered).toContain('## Queries');
		expect(rendered).not.toContain('## Stories');
	});
});
