import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { compactionService } from '../services/compaction';
import type { ForkMetadata, UIMessage, UIMessagePart } from '../types/chat';
import { protectedProcedure } from './trpc';

const shareTypeSchema = z.enum(['chat', 'story']);
const selectionSchema = z.object({ start: z.number(), end: z.number(), text: z.string() });

export interface SelectionInfo {
	start: number;
	end: number;
	text: string;
}

export const chatForkRoutes = {
	fork: protectedProcedure
		.input(
			z.object({
				shareId: z.string(),
				type: shareTypeSchema,
				selection: selectionSchema.optional(),
			}),
		)
		.mutation(async ({ input, ctx }): Promise<{ chatId: string }> => {
			if (input.type === 'chat') {
				return forkSharedChat(input.shareId, input.selection, ctx.user.id);
			}
			return forkSharedStoryItem(input.shareId, input.selection, ctx.user.id);
		}),

	getSelectionForks: protectedProcedure
		.input(z.object({ shareId: z.string(), type: shareTypeSchema }))
		.query(async ({ input, ctx }) => {
			const forkType = input.type === 'chat' ? 'chat_selection' : 'story_selection';
			return chatQueries.getSelectionForksByShareId(ctx.user.id, input.shareId, forkType);
		}),
};

async function forkSharedChat(
	shareId: string,
	selection: SelectionInfo | undefined,
	userId: string,
): Promise<{ chatId: string }> {
	const share = await resolveSharedChat(shareId, userId);

	const forkMetadata: ForkMetadata = selection
		? buildSelectionMetadata('chat_selection', shareId, share.title, share.authorName, selection)
		: { type: 'chat', id: share.chatId, title: share.title, authorName: share.authorName };

	const rawMessages = await chatQueries.getChatMessages(share.chatId);
	const seededMessages = compactionService.useLastCompaction(rawMessages);
	const messages = selection
		? [...seededMessages, buildSelectionContextMessage(share.title, selection)]
		: seededMessages;

	const savedChat = await chatQueries.createForkedChat(
		{ projectId: share.projectId, userId, title: share.title, forkMetadata },
		messages,
	);

	await copyStoriesToFork(share.chatId, savedChat.id);

	return { chatId: savedChat.id };
}

async function forkSharedStoryItem(
	shareId: string,
	selection: SelectionInfo | undefined,
	userId: string,
): Promise<{ chatId: string }> {
	const share = await resolveSharedStory(shareId, userId);
	const projectId = share.projectId;

	const forkMetadata: ForkMetadata = selection
		? buildSelectionMetadata('story_selection', shareId, share.title, share.authorName, selection)
		: { type: 'story', id: share.storyId, title: share.title, authorName: share.authorName };

	if (selection) {
		const rawMessages = await chatQueries.getChatMessages(share.chatId);
		const seededMessages = compactionService.useLastCompaction(rawMessages);
		const messages = [...seededMessages, buildSelectionContextMessage(share.title, selection)];

		const chat = await chatQueries.createForkedChat(
			{ projectId, userId, title: share.title, forkMetadata },
			messages,
		);

		await copyStoriesToFork(share.chatId, chat.id);
		return { chatId: chat.id };
	}

	const queryData = await sharedStoryQueries.getQueryDataFromCode(share.chatId, share.code);
	const messages = buildQueryDataMessages(queryData);

	const chat = await chatQueries.createForkedChat({ projectId, userId, title: share.title, forkMetadata }, messages);

	await createStoryInFork(chat.id, share.slug, share.title, share.code);
	return { chatId: chat.id };
}

async function resolveSharedChat(shareId: string, userId: string) {
	const share = await sharedChatQueries.getSharedChatInfo(shareId);
	if (!share) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
	}
	const userRole = await projectQueries.getUserRoleInProject(share.projectId, userId);
	if (!userRole) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	if (share.visibility === 'specific' && share.userId !== userId) {
		const hasAccess = await sharedChatQueries.canUserAccessSharedChat(share.id, userId);
		if (!hasAccess) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
		}
	}
	return share;
}

async function resolveSharedStory(shareId: string, userId: string) {
	const share = await sharedStoryQueries.getSharedStory(shareId);
	if (!share) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
	}
	const userRole = await projectQueries.getUserRoleInProject(share.projectId, userId);
	if (!userRole) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	if (share.visibility === 'specific' && share.userId !== userId) {
		const hasAccess = await sharedStoryQueries.canUserAccessSharedStory(share.id, userId);
		if (!hasAccess) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
		}
	}
	return share;
}

function buildSelectionMetadata(
	type: 'chat_selection' | 'story_selection',
	shareId: string,
	title: string,
	authorName: string,
	selection: SelectionInfo,
): ForkMetadata {
	return {
		type,
		id: shareId,
		title,
		authorName,
		selectionStart: selection.start,
		selectionEnd: selection.end,
		selectionText: selection.text,
	};
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

	return [{ role: 'assistant', isForked: true, parts }];
}

async function createStoryInFork(chatId: string, slug: string, title: string, code: string): Promise<void> {
	const version = await storyQueries.createStoryVersion({
		chatId,
		slug,
		title,
		code,
		action: 'create',
		source: 'assistant',
	});

	await chatQueries.upsertMessage({
		chatId,
		role: 'assistant',
		parts: [
			{
				type: 'tool-story',
				toolCallId: crypto.randomUUID(),
				toolName: 'story',
				state: 'output-available',
				input: { action: 'create', id: slug, title, code },
				output: { _version: '1', success: true, id: slug, version: version.version, code, title },
				errorText: undefined,
				providerExecuted: false,
			} as UIMessagePart,
		],
	});
}

async function copyStoriesToFork(sourceChatId: string, forkChatId: string): Promise<void> {
	const stories = await storyQueries.listStoriesInChat(sourceChatId);
	if (stories.length === 0) {
		return;
	}

	await Promise.all(
		stories.map(async ({ slug }) => {
			const latest = await storyQueries.getLatestVersion(sourceChatId, slug);
			if (!latest) {
				return;
			}
			await storyQueries.createStoryVersion({
				chatId: forkChatId,
				slug,
				title: latest.title,
				code: latest.code,
				action: 'create',
				source: 'assistant',
			});
		}),
	);
}
