import type { CustomStoryViewerAccess } from '@nao/shared/story-app';
import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as storyQueries from '../queries/story.queries';
import {
	getCustomStoryFile,
	getCustomStoryNarratives,
	getCustomStoryVersion,
	getSharedCustomStoryQueryData,
	getSharedCustomStoryQuerySql,
} from '../services/custom-story';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { storySnapshotHtml, toCustomStoryQueryTrpcError, toCustomStoryTrpcError } from '../utils/custom-story-trpc';
import { buildStorySnapshotDownload } from '../utils/story-snapshot';
import { protectedProcedure } from './trpc';

const viewerAccess = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('sharedChat'), shareId: z.string() }),
	z.object({ kind: z.literal('replay'), chatId: z.string() }),
]) satisfies z.ZodType<CustomStoryViewerAccess>;

interface ResolvedViewerAccess {
	chatId: string;
	projectId: string;
	sharedChatId: string | null;
}

const versionNumber = z.number().int().positive().optional();

const viewerProcedure = protectedProcedure
	.input(z.object({ access: viewerAccess, storySlug: z.string() }))
	.use(async ({ ctx, input, next }) => {
		const viewer = await resolveViewerAccess(input.access, ctx.user.id);
		return next({ ctx: { viewer } });
	});

export const customStoryViewerRoutes = {
	getFormat: viewerProcedure.query(async ({ ctx, input }) => {
		const story = await storyQueries.getStoryByChatAndSlug(ctx.viewer.chatId, input.storySlug);
		return { format: story?.format ?? null };
	}),

	getVersion: viewerProcedure.input(z.object({ versionNumber })).query(async ({ ctx, input }) => {
		try {
			return await getCustomStoryVersion(ctx.viewer.chatId, input.storySlug, input.versionNumber);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	getFile: viewerProcedure.input(z.object({ path: z.string(), versionNumber })).query(async ({ ctx, input }) => {
		try {
			return await getCustomStoryFile(ctx.viewer.chatId, input.storySlug, input.path, input.versionNumber);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	getQueryData: viewerProcedure
		.input(z.object({ queryId: z.string(), versionNumber }))
		.query(async ({ ctx, input }) => {
			try {
				return await getSharedCustomStoryQueryData(
					ctx.viewer.chatId,
					input.storySlug,
					input.queryId,
					input.versionNumber,
				);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	getQuerySql: viewerProcedure
		.input(z.object({ queryId: z.string(), versionNumber }))
		.query(async ({ ctx, input }) => {
			try {
				const sqlQuery = await getSharedCustomStoryQuerySql(
					ctx.viewer.chatId,
					input.storySlug,
					input.queryId,
					input.versionNumber,
				);
				return { sqlQuery };
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getNarratives: viewerProcedure.query(async ({ ctx, input }) => {
		try {
			return await getCustomStoryNarratives(ctx.viewer.chatId, input.storySlug);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	download: viewerProcedure
		.input(z.object({ format: z.enum(DOWNLOAD_FORMATS), html: storySnapshotHtml, versionNumber }))
		.mutation(async ({ ctx, input }) => {
			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(ctx.viewer.chatId, input.storySlug, input.versionNumber)
				: await storyQueries.getLatestVersionByChatAndSlug(ctx.viewer.chatId, input.storySlug);
			if (!version || version.format !== 'custom') {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			logAnalyticsEvent({
				projectId: ctx.viewer.projectId,
				type: 'download',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: version.storyId,
				chatId: ctx.viewer.chatId,
				...(ctx.viewer.sharedChatId && { sharedChatId: ctx.viewer.sharedChatId }),
				metadata: {
					type: 'download',
					format: input.format,
					versionNumber: version.version,
					title: version.title,
				},
			});

			return buildStorySnapshotDownload(input.format, version.title, input.html);
		}),
};

async function resolveViewerAccess(access: CustomStoryViewerAccess, userId: string): Promise<ResolvedViewerAccess> {
	if (access.kind === 'sharedChat') {
		return resolveSharedChatAccess(access.shareId, userId);
	}
	return resolveReplayAccess(access.chatId, userId);
}

async function resolveSharedChatAccess(shareId: string, userId: string): Promise<ResolvedViewerAccess> {
	const share = await sharedChatQueries.getSharedChatInfo(shareId);
	if (!share) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
	}
	if (!(await projectQueries.getUserRoleInProject(share.projectId, userId))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	const canAccess =
		share.visibility !== 'specific' ||
		share.userId === userId ||
		(await sharedChatQueries.canUserAccessSharedChat(share.id, userId));
	if (!canAccess) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this shared chat.' });
	}
	return { chatId: share.chatId, projectId: share.projectId, sharedChatId: share.id };
}

/** Same rule as `project.getChatReplay`: admins and context admins of the chat's project. */
async function resolveReplayAccess(chatId: string, userId: string): Promise<ResolvedViewerAccess> {
	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
	}
	const role = await projectQueries.getUserRoleInProject(projectId, userId);
	if (role !== 'admin' && role !== 'context_admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins or context admins can replay chats.' });
	}
	return { chatId, projectId, sharedChatId: null };
}
