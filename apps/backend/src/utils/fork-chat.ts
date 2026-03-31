import * as chatQueries from '../queries/chat.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { compactionService } from '../services/compaction';
import type { ForkedMetadata, ForkMetadata, UIMessage, UIMessagePart } from '../types/chat';

export interface SelectionInfo {
	start: number;
	end: number;
	text: string;
}

export async function forkChat(opts: {
	chatId: string;
	projectId: string;
	userId: string;
	forkMetadata?: ForkMetadata;
}): Promise<{ chatId: string }> {
	const rawMessages = await chatQueries.loadChatMessages(opts.chatId);
	const seededMessages = compactionService.useLastCompaction(rawMessages);

	const savedChat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.forkMetadata?.title,
			forkMetadata: opts.forkMetadata as ForkedMetadata | undefined,
		},
		seededMessages,
	);

	await copyStoriesToFork(opts.chatId, savedChat.id);

	return { chatId: savedChat.id };
}

export async function forkStory(opts: {
	sourceChatId: string;
	projectId: string;
	userId: string;
	storyId: string;
	title: string;
	code: string;
	authorName: string;
}): Promise<{ chatId: string }> {
	const queryData = await sharedStoryQueries.collectQueryData(opts.sourceChatId, opts.code);
	const seededMessages = buildQueryDataMessages(queryData);

	const chat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.title,
			forkMetadata: { type: 'story', id: opts.storyId, title: opts.title, authorName: opts.authorName },
		},
		seededMessages,
	);

	const version = await storyQueries.createVersion({
		chatId: chat.id,
		storyId: opts.storyId,
		title: opts.title,
		code: opts.code,
		action: 'create',
		source: 'assistant',
	});

	await chatQueries.upsertMessage({
		chatId: chat.id,
		role: 'assistant',
		parts: [
			{
				type: 'tool-story',
				toolCallId: crypto.randomUUID(),
				toolName: 'story',
				state: 'output-available',
				input: { action: 'create', id: opts.storyId, title: opts.title, code: opts.code },
				output: {
					_version: '1',
					success: true,
					id: opts.storyId,
					version: version.version,
					code: opts.code,
					title: opts.title,
				},
				errorText: undefined,
				providerExecuted: false,
			} as UIMessagePart,
		],
	});

	return { chatId: chat.id };
}

export async function forkSharedChatFromSelection(opts: {
	shareId: string;
	projectId: string;
	userId: string;
	selection: SelectionInfo;
	authorName: string;
	title: string;
}): Promise<{ chatId: string }> {
	const share = await sharedChatQueries.getSharedChatInfo(opts.shareId);
	if (!share) {
		throw new Error('Shared chat not found.');
	}

	const rawMessages = await chatQueries.loadChatMessages(share.chatId);
	const seededMessages = compactionService.useLastCompaction(rawMessages);

	const forkMetadata: ForkMetadata = {
		type: 'chat_selection',
		id: opts.shareId,
		title: opts.title,
		authorName: opts.authorName,
		selectionStart: opts.selection.start,
		selectionEnd: opts.selection.end,
		selectionText: opts.selection.text,
	};

	const contextMessage = buildSelectionContextMessage(opts.title, opts.selection);
	const savedChat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.title,
			forkMetadata: forkMetadata as ForkedMetadata,
		},
		[...seededMessages, contextMessage],
	);

	await copyStoriesToFork(share.chatId, savedChat.id);

	return { chatId: savedChat.id };
}

export async function forkSharedStoryFromSelection(opts: {
	shareId: string;
	projectId: string;
	userId: string;
	selection: SelectionInfo;
	authorName: string;
	title: string;
	code: string;
	sourceChatId: string;
}): Promise<{ chatId: string }> {
	const queryData = await sharedStoryQueries.collectQueryData(opts.sourceChatId, opts.code);
	const seededMessages = buildQueryDataMessages(queryData);

	const forkMetadata: ForkMetadata = {
		type: 'story_selection',
		id: opts.shareId,
		title: opts.title,
		authorName: opts.authorName,
		selectionStart: opts.selection.start,
		selectionEnd: opts.selection.end,
		selectionText: opts.selection.text,
	};

	const contextMessage = buildSelectionContextMessage(opts.title, opts.selection);
	const savedChat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.title,
			forkMetadata: forkMetadata as ForkedMetadata,
		},
		[...seededMessages, contextMessage],
	);

	return { chatId: savedChat.id };
}

async function copyStoriesToFork(sourceChatId: string, forkChatId: string): Promise<void> {
	const stories = await storyQueries.listStoriesInChat(sourceChatId);
	if (stories.length === 0) {
		return;
	}

	await Promise.all(
		stories.map(async ({ storyId }) => {
			const latest = await storyQueries.getLatestVersion(sourceChatId, storyId);
			if (!latest) {
				return;
			}
			await storyQueries.createVersion({
				chatId: forkChatId,
				storyId,
				title: latest.title,
				code: latest.code,
				action: 'create',
				source: 'assistant',
			});
		}),
	);
}

function buildQueryDataMessages(
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null,
): Array<Omit<UIMessage, 'id'>> {
	if (!queryData || Object.keys(queryData).length === 0) {
		return [];
	}

	const parts: UIMessagePart[] = Object.entries(queryData).map(
		([queryId, { data, columns }]) =>
			({
				type: 'tool-execute_sql',
				toolName: 'execute_sql',
				toolCallId: crypto.randomUUID(),
				state: 'output-available',
				input: { sql_query: '' },
				output: { id: queryId as `query_${string}`, data, columns, row_count: data.length },
				providerExecuted: false,
				errorText: undefined,
			}) as unknown as UIMessagePart,
	);

	return [{ role: 'assistant', synthetic: true, parts }];
}

function buildSelectionContextMessage(sourceTitle: string, selection: SelectionInfo): Omit<UIMessage, 'id'> {
	return {
		role: 'assistant',
		parts: [
			{
				type: 'text',
				text: `**From "${sourceTitle}"** — @chars ${selection.start}–${selection.end}:\n\n> ${selection.text}`,
			},
		],
	};
}
