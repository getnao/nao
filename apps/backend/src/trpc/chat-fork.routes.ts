import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import { compactionService } from '../services/compaction';
import { attachChatToStandaloneStory } from '../services/standalone-story';
import { forkStoryIntoChat } from '../services/story-fork';
import type { ForkMetadata, UIMessage, UIMessagePart } from '../types/chat';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { buildQueryDataMessages } from '../utils/chat-message-story';
import { canSendProcedure, cloudBillingMiddleware, projectProtectedProcedure, protectedProcedure } from './trpc';
import { assertUserGroupFeatureForTrpc } from './user-group-feature-access';

const selectionSchema = z.object({ start: z.number(), end: z.number(), text: z.string() });
const forkSourceSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('chat'), shareId: z.string() }),
	z.object({ type: z.literal('story'), storyId: z.string() }),
]);
const forkInputSchema = z.object({ source: forkSourceSchema, selection: selectionSchema.optional() });
const storyIdInputSchema = z.object({ storyId: z.string() });
const MAX_QUICK_QUESTIONS = 10;
const MAX_ASK_SELECTION_LENGTH = 4_000;
/** A long selection is cut rather than refused, so the question is still asked. */
const selectionTextSchema = z
	.string()
	.trim()
	.transform((text) => text.slice(0, MAX_ASK_SELECTION_LENGTH));

const resolvedForkProcedure = canSendProcedure.input(forkInputSchema).use(async ({ ctx, input, next }) => {
	const source =
		input.source.type === 'chat'
			? { type: 'chat' as const, share: await resolveSharedChat(input.source.shareId, ctx.user.id) }
			: { type: 'story' as const, share: await resolveSharedStory(input.source.storyId, ctx.user.id) };
	return next({ ctx: { source } });
});

const resolvedSharedChatProcedure = protectedProcedure
	.input(z.object({ shareId: z.string() }))
	.use(async ({ ctx, input, next }) => next({ ctx: { share: await resolveSharedChat(input.shareId, ctx.user.id) } }));

const sharedChatQuestionProcedure = canSendProcedure
	.input(z.object({ shareId: z.string(), selection: selectionSchema.optional() }))
	.use(async ({ ctx, input, next }) => next({ ctx: { share: await resolveSharedChat(input.shareId, ctx.user.id) } }))
	.use(
		cloudBillingMiddleware<{ share: sharedChatQueries.SharedChatWithDetails }>(({ share }) => ({
			projectId: share.projectId,
		})),
	);

const cloudBillingForkProcedure = resolvedForkProcedure.use(
	cloudBillingMiddleware<{
		source:
			| { type: 'chat'; share: sharedChatQueries.SharedChatWithDetails }
			| { type: 'story'; share: sharedStoryQueries.SharedStoryWithLatest };
	}>(({ source }) => ({ projectId: source.share.projectId })),
);

/** The story is forked in its own project, whatever project is active, like the fork of a share. */
const resolvedStoryForkProcedure = protectedProcedure.input(storyIdInputSchema).use(async ({ ctx, input, next }) => {
	const projectId = await storyQueries.getStoryProjectId(input.storyId);
	const story = projectId
		? await storyReferenceQueries.getReferenceableStory(ctx.user.id, projectId, input.storyId)
		: null;
	if (!projectId || !story) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	const userRole = await projectQueries.getUserRoleInProject(projectId, ctx.user.id);
	if (userRole !== 'admin' && userRole !== 'user' && userRole !== 'context_admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot perform this action' });
	}
	return next({ ctx: { story, projectId } });
});

const storyForkProcedure = resolvedStoryForkProcedure.use(
	cloudBillingMiddleware<{ projectId: string }>(({ projectId }) => ({ projectId })),
);

const resolvedStandaloneStoryProcedure = projectProtectedProcedure
	.input(storyIdInputSchema)
	.use(async ({ ctx, input, next }) => {
		const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
		if (!story || story.projectId !== ctx.project.id) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		return next({ ctx: { story } });
	});

const openStandaloneProcedure = resolvedStandaloneStoryProcedure.use(
	cloudBillingMiddleware<{ project: { id: string; orgId: string | null }; story: { chatId: string | null } }>(
		({ project, story }) => (story.chatId ? null : { projectId: project.id, organizationId: project.orgId }),
	),
);

type SharedChatForkKind = 'fork' | 'question';

export interface SelectionInfo {
	start: number;
	end: number;
	text: string;
}

export const chatForkRoutes = {
	fork: cloudBillingForkProcedure.mutation(async ({ input, ctx }): Promise<{ chatId: string }> => {
		if (ctx.source.type === 'chat') {
			return forkSharedChat(ctx.source.share, input.selection, ctx.user.id, 'fork');
		}
		return forkSharedStoryItem(ctx.source.share, input.selection, ctx.user.id);
	}),

	/** A quick question about a shared chat: a fork of it, kept out of the chat history. */
	askSharedChat: sharedChatQuestionProcedure.mutation(
		async ({ input, ctx }): Promise<{ chatId: string }> =>
			forkSharedChat(ctx.share, input.selection, ctx.user.id, 'question'),
	),

	listSharedChatQuickQuestions: resolvedSharedChatProcedure.query(async ({ ctx }) =>
		chatQueries.listQuickQuestionChats(ctx.user.id, ctx.share.id, MAX_QUICK_QUESTIONS),
	),

	askStory: storyForkProcedure
		.input(z.object({ selectionText: selectionTextSchema.optional() }))
		.mutation(async ({ ctx, input }): Promise<{ chatId: string; hasAttachedStoryChat: boolean }> => {
			const { story, projectId, user } = ctx;
			const hasAttachedStoryChat = !story.chatId && story.ownerId === user.id;
			if (hasAttachedStoryChat) {
				await attachChatToStandaloneStory(
					{ id: story.storyId, slug: story.slug, title: story.title, code: story.code },
					{ userId: user.id, projectId },
				);
			}
			const forkMetadata: ForkMetadata = {
				type: 'story_question',
				id: story.storyId,
				title: story.title,
				authorName: story.authorName ?? '',
				...(input.selectionText && { selectionText: input.selectionText }),
			};
			const chat = await chatQueries.createForkedChat(
				{ projectId, userId: user.id, title: story.title, forkMetadata },
				[],
			);
			return { chatId: chat.id, hasAttachedStoryChat };
		}),

	forkStory: storyForkProcedure.mutation(async ({ ctx }): Promise<{ chatId: string }> => {
		const { story, projectId, user } = ctx;
		if (story.ownerId !== user.id) {
			await assertUserGroupFeatureForTrpc(projectId, user.id, 'storyCreation');
		}
		const { chatId } = await forkStoryIntoChat(story, { userId: user.id, projectId });
		logStoryFork({ ...story, projectId }, user.id, chatId, 'full');
		return { chatId };
	}),

	openStandalone: openStandaloneProcedure.mutation(async ({ ctx }): Promise<{ chatId: string }> => {
		const { story } = ctx;
		if (story.chatId) {
			return { chatId: story.chatId };
		}
		const { chatId } = await attachChatToStandaloneStory(story, { userId: ctx.user.id, projectId: ctx.project.id });

		logAnalyticsEvent({
			projectId: ctx.project.id,
			type: 'fork',
			assetType: 'story',
			actorUserId: ctx.user.id,
			storyId: story.id,
			metadata: { type: 'fork', resultId: chatId, scope: 'full', versionNumber: story.version },
		});

		return { chatId };
	}),
};

async function forkSharedChat(
	share: sharedChatQueries.SharedChatWithDetails,
	selection: SelectionInfo | undefined,
	userId: string,
	kind: SharedChatForkKind,
): Promise<{ chatId: string }> {
	const forkMetadata = buildSharedChatForkMetadata(share, selection, kind);

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

	if (selection) {
		const forkMetadata = buildSelectionMetadata(
			'story_selection',
			share.storyId,
			share.title,
			share.authorName,
			selection,
		);
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

		logStoryFork({ ...share, sharedStoryId: share.id }, userId, chat.id, 'selection');
		return { chatId: chat.id };
	}

	const { chatId } = await forkStoryIntoChat(share, { userId, projectId });
	logStoryFork({ ...share, sharedStoryId: share.id }, userId, chatId, 'full');
	return { chatId };
}

function logStoryFork(
	story: { projectId: string; storyId: string; chatId: string | null; sharedStoryId?: string; version: number },
	userId: string,
	resultChatId: string,
	scope: 'full' | 'selection',
): void {
	logAnalyticsEvent({
		projectId: story.projectId,
		type: 'fork',
		assetType: 'story',
		actorUserId: userId,
		storyId: story.storyId,
		chatId: story.chatId,
		sharedStoryId: story.sharedStoryId,
		metadata: { type: 'fork', resultId: resultChatId, scope, versionNumber: story.version },
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

/** A question is tied to the share, like a selection, so it is listed on the shared chat's page. */
function buildSharedChatForkMetadata(
	share: sharedChatQueries.SharedChatWithDetails,
	selection: SelectionInfo | undefined,
	kind: SharedChatForkKind,
): ForkMetadata {
	if (kind === 'question') {
		return selection
			? buildSelectionMetadata('chat_question', share.id, share.title, share.authorName, selection)
			: { type: 'chat_question', id: share.id, title: share.title, authorName: share.authorName };
	}
	return selection
		? buildSelectionMetadata('chat_selection', share.id, share.title, share.authorName, selection)
		: { type: 'chat', id: share.chatId, title: share.title, authorName: share.authorName };
}

function buildSelectionMetadata(
	type: 'chat_selection' | 'chat_question' | 'story_selection',
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
