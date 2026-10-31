import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import {
	getActiveThemeForStory,
	getStandaloneCustomStoryFile,
	getStandaloneCustomStoryNarratives,
	getStandaloneCustomStoryQueryData,
	getStandaloneCustomStoryVersion,
} from '../services/custom-story';
import { getCustomStoryStateByStoryId, setCustomStoryStateByStoryId } from '../services/custom-story-state';
import { logAnalyticsEvent } from '../utils/analytics-event';
import {
	storySnapshotHtml,
	storyStateChange,
	toCustomStoryQueryTrpcError,
	toCustomStoryTrpcError,
} from '../utils/custom-story-trpc';
import { themeFontStylesheets } from '../utils/story-headless-page';
import { buildStorySnapshotDownload } from '../utils/story-snapshot';
import { protectedProcedure } from './trpc';

const versionNumber = z.number().int().positive().optional();

/** A custom story outside any chat, opened by its owner. */
const standaloneOwnerProcedure = protectedProcedure
	.input(z.object({ storyId: z.string() }))
	.use(async ({ ctx, input, next }) => {
		const story = await storyQueries.getStoryById(input.storyId);
		const isOwnedStandalone =
			story !== null &&
			story.chatId === null &&
			story.format === 'custom' &&
			story.userId === ctx.user.id &&
			story.projectId !== null &&
			Boolean(await projectQueries.getUserRoleInProject(story.projectId, ctx.user.id));
		if (!isOwnedStandalone) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		return next({ ctx: { story: { ...story, projectId: story.projectId! } } });
	});

export const standaloneCustomStoryRoutes = {
	listVersions: standaloneOwnerProcedure.query(async ({ ctx }) => {
		const versions = await storyQueries.listStoryVersionsByStoryId(ctx.story.id);
		return {
			id: ctx.story.id,
			title: ctx.story.title,
			slug: ctx.story.slug,
			archivedAt: ctx.story.archivedAt,
			versions: versions.map(({ version, createdAt }) => ({ version, createdAt })),
		};
	}),

	getVersion: standaloneOwnerProcedure.input(z.object({ versionNumber })).query(async ({ ctx, input }) => {
		try {
			return await getStandaloneCustomStoryVersion(ctx.story.id, input.versionNumber);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	getFile: standaloneOwnerProcedure
		.input(z.object({ path: z.string(), versionNumber }))
		.query(async ({ ctx, input }) => {
			try {
				return await getStandaloneCustomStoryFile(ctx.story.id, input.path, input.versionNumber);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getQueryData: standaloneOwnerProcedure
		.input(z.object({ queryId: z.string(), versionNumber }))
		.query(async ({ ctx, input }) => {
			try {
				return await getStandaloneCustomStoryQueryData(ctx.story.id, input.queryId, input.versionNumber);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	getQuerySql: standaloneOwnerProcedure.input(z.object({ queryId: z.string() })).query((): { sqlQuery: string } => {
		throw new TRPCError({
			code: 'NOT_FOUND',
			message:
				'This story keeps the rows of its queries but not their SQL. Edit it in a chat to work on its queries.',
		});
	}),

	getNarratives: standaloneOwnerProcedure.query(async ({ ctx }) => {
		try {
			return await getStandaloneCustomStoryNarratives(ctx.story.id);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	getState: standaloneOwnerProcedure.query(({ ctx }) => getCustomStoryStateByStoryId(ctx.story.id, ctx.user.id)),

	setState: standaloneOwnerProcedure
		.input(z.object({ change: storyStateChange }))
		.mutation(async ({ ctx, input }) => {
			try {
				await setCustomStoryStateByStoryId(ctx.story.id, ctx.user.id, input.change);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	download: standaloneOwnerProcedure
		.input(z.object({ format: z.enum(DOWNLOAD_FORMATS), html: storySnapshotHtml, versionNumber }))
		.mutation(async ({ ctx, input }) => {
			const version = input.versionNumber
				? await storyQueries.getVersionByStoryIdAndNumber(ctx.story.id, input.versionNumber)
				: await storyQueries.getLatestVersionByStoryId(ctx.story.id);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			logAnalyticsEvent({
				projectId: ctx.story.projectId,
				type: 'download',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: ctx.story.id,
				metadata: {
					type: 'download',
					format: input.format,
					versionNumber: version.version,
					title: version.title,
				},
			});

			const fontStylesheets = themeFontStylesheets(await getActiveThemeForStory(ctx.story.id));
			return buildStorySnapshotDownload(input.format, version.title, input.html, fontStylesheets);
		}),
};
