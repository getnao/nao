import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { compactionService } from '../services/compaction';
import type { ForkMetadata, UIMessage, UIMessagePart } from '../types/chat';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { buildQueryDataParts, pinStoryMessageToChat } from '../utils/chat-message-story';
import { canSendProcedure, cloudBillingMiddleware, projectProtectedProcedure, protectedProcedure } from './trpc';
import { assertUserGroupFeatureForTrpc } from './user-group-feature-access';

const selectionSchema = z.object({ start: z.number(), end: z.number(), text: z.string() });
const forkSourceSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('chat'), shareId: z.string() }),
	z.object({ type: z.literal('story'), storyId: z.string() }),
]);
const forkInputSchema = z.object({ source: forkSourceSchema, selection: selectionSchema.optional() });
const openStandaloneInputSchema = z.object({ storyId: z.string() });

const resolvedForkProcedure = canSendProcedure.input(forkInputSchema).use(async ({ ctx, input, next }) => {
	const source =
		input.source.type === 'chat'
			? { type: 'chat' as const, share: await resolveSharedChat(input.source.shareId, ctx.user.id) }
			: { type: 'story' as const, share: await resolveSharedStory(input.source.storyId, ctx.user.id) };
	return next({ ctx: { source } });
});

const cloudBillingForkProcedure = resolvedForkProcedure.use(
	cloudBillingMiddleware<{
		source:
			| { type: 'chat'; share: sharedChatQueries.SharedChatWithDetails }
			| { type: 'story'; share: sharedStoryQueries.SharedStoryWithLatest };
	}>(({ source }) => ({ projectId: source.share.projectId })),
);

const openStandaloneProcedure = projectProtectedProcedure.input(openStandaloneInputSchema).use(
	cloudBillingMiddleware<
		{ project: { id: string; orgId: string | null }; user: { id: string } },
		z.infer<typeof openStandaloneInputSchema>
	>(async (ctx, input) => {
		const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
		return story?.projectId === ctx.project.id && !story.chatId
			? { projectId: ctx.project.id, organizationId: ctx.project.orgId }
			: null;
	}),
);

export interface SelectionInfo {
	start: number;
	end: number;
	text: string;
}

export const chatForkRoutes = {
	fork: cloudBillingForkProcedure.mutation(async ({ input, ctx }): Promise<{ chatId: string }> => {
		if (ctx.source.type === 'chat') {
			return forkSharedChat(ctx.source.share, input.selection, ctx.user.id);
		}
		return forkSharedStoryItem(ctx.source.share, input.selection, ctx.user.id);
	}),

	openStandalone: openStandaloneProcedure.mutation(async ({ input, ctx }): Promise<{ chatId: string }> => {
		const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
		if (!story || story.projectId !== ctx.project.id) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		if (story.chatId) {
			return { chatId: story.chatId };
		}
		const cache = await storyQueries.getStoryDataCacheByStoryId(story.id);
		const seedMessages = cache?.queryData
			? buildQueryDataMessages(cache.queryData as Record<string, { data: unknown[]; columns: string[] }>)
			: [];

		const chat = await chatQueries.createForkedChat(
			{ projectId: ctx.project.id, userId: ctx.user.id, title: story.title },
			seedMessages,
		);

		const latestVersion = await storyQueries.getLatestVersionByStoryId(story.id);
		await storyQueries.assignChatToStory(story.id, chat.id);
		await pinStoryMessageToChat({
			chatId: chat.id,
			slug: story.slug,
			title: story.title,
			code: story.code,
			version: latestVersion?.version ?? 1,
		});

		logAnalyticsEvent({
			projectId: ctx.project.id,
			type: 'fork',
			assetType: 'story',
			actorUserId: ctx.user.id,
			storyId: story.id,
			metadata: { type: 'fork', resultId: chat.id, scope: 'full', versionNumber: story.version },
		});

		return { chatId: chat.id };
	}),

	getSelectionForks: protectedProcedure
		.input(z.object({ source: forkSourceSchema }))
		.query(async ({ input, ctx }) => {
			if (input.source.type === 'chat') {
				return chatQueries.getSelectionForksBySourceId(ctx.user.id, input.source.shareId, 'chat_selection');
			}
			await resolveSharedStory(input.source.storyId, ctx.user.id);
			return chatQueries.getSelectionForksBySourceId(ctx.user.id, input.source.storyId, 'story_selection');
		}),
};

async function forkSharedChat(
	share: sharedChatQueries.SharedChatWithDetails,
	selection: SelectionInfo | undefined,
	userId: string,
): Promise<{ chatId: string }> {
	const forkMetadata: ForkMetadata = selection
		? buildSelectionMetadata('chat_selection', share.id, share.title, share.authorName, selection)
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

	logAnalyticsEvent({
		projectId: share.projectId,
		type: 'fork',
		assetType: 'chat',
		actorUserId: userId,
		chatId: share.chatId,
		sharedChatId: share.id,
		metadata: { type: 'fork', resultId: savedChat.id, scope: selection ? 'selection' : 'full' },
	});

	return { chatId: savedChat.id };
}

async function forkSharedStoryItem(
	share: sharedStoryQueries.SharedStoryWithLatest,
	selection: SelectionInfo | undefined,
	userId: string,
): Promise<{ chatId: string }> {
	const projectId = share.projectId;
	if (userId !== share.userId) {
		await assertUserGroupFeatureForTrpc(projectId, userId, 'storyCreation');
	}

	const forkMetadata: ForkMetadata = selection
		? buildSelectionMetadata('story_selection', share.storyId, share.title, share.authorName, selection)
		: { type: 'story', id: share.storyId, title: share.title, authorName: share.authorName };

	if (selection) {
		const [rawMessages, queryData] = await Promise.all([
			chatQueries.getChatMessages(share.chatId!),
			sharedStoryQueries.getQueryDataFromCode(share.chatId!, share.code),
		]);
		const seededMessages = compactionService.useLastCompaction(rawMessages);
		const messages = [
			...buildQueryDataMessages(queryData),
			buildStoryContextMessage(share.slug, share.title, share.code),
			...seededMessages,
			buildSelectionContextMessage(share.title, selection),
		];

		const chat = await chatQueries.createForkedChat(
			{ projectId, userId, title: share.title, forkMetadata },
			messages,
		);

		logStoryFork(share, userId, chat.id, 'selection');
		return { chatId: chat.id };
	}

	const queryData = await sharedStoryQueries.getQueryDataFromCode(share.chatId!, share.code);
	const messages = buildQueryDataMessages(queryData);

	const chat = await chatQueries.createForkedChat({ projectId, userId, title: share.title, forkMetadata }, messages);

	await createStoryInFork(chat.id, share.slug, share.title, share.code, { userId, projectId });
	logStoryFork(share, userId, chat.id, 'full');
	return { chatId: chat.id };
}

function logStoryFork(
	share: { projectId: string; storyId: string; chatId: string | null; id: string; version: number },
	userId: string,
	resultChatId: string,
	scope: 'full' | 'selection',
): void {
	logAnalyticsEvent({
		projectId: share.projectId,
		type: 'fork',
		assetType: 'story',
		actorUserId: userId,
		storyId: share.storyId,
		chatId: share.chatId,
		sharedStoryId: share.id,
		metadata: { type: 'fork', resultId: resultChatId, scope, versionNumber: share.version },
	});
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

async function resolveSharedStory(storyId: string, userId: string) {
	const share = await sharedStoryQueries.getSharedStoryByStoryId(storyId);
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
	sourceId: string,
	title: string,
	authorName: string,
	selection: SelectionInfo,
): ForkMetadata {
	return {
		type,
		id: sourceId,
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
	const parts = buildQueryDataParts(queryData);
	if (parts.length === 0) {
		return [];
	}
	return [{ role: 'assistant', isForked: true, parts }];
}

async function createStoryInFork(
	chatId: string,
	slug: string,
	title: string,
	code: string,
	context?: { userId: string; projectId: string },
): Promise<void> {
	const version = await storyQueries.createStoryVersion({
		chatId,
		slug,
		title,
		code,
		action: 'create',
		source: 'assistant',
	});

	await pinStoryMessageToChat({ chatId, slug, title, code, version: version.version });

	if (context) {
		await storyFolderQueries.saveStoryInPrivateRoot(context.userId, context.projectId, version.storyId);
	}
}

function buildStoryContextMessage(slug: string, title: string, code: string): Omit<UIMessage, 'id'> {
	return {
		role: 'assistant',
		parts: [
			{
				type: 'tool-story',
				toolCallId: crypto.randomUUID(),
				toolName: 'story',
				state: 'output-available',
				input: { action: 'create', id: slug, title, code },
				output: { _version: '1', success: true, id: slug, version: 1, code, title },
				errorText: undefined,
				providerExecuted: false,
			} as UIMessagePart,
		],
	};
}
