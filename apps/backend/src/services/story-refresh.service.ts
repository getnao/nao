import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { TRPCError } from '@trpc/server';

import type { DBStory } from '../db/abstractSchema';
import { STORY_REFRESH_JOB_NAME } from '../handlers/story-refresh.handler';
import * as activityQueries from '../queries/activity.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { hasOnlyFrozenQueries, listQueryIdsWithoutSql, refreshStoryById, type StoryQueryData } from './live-story';
import { notifyStoryRefreshed, notifyStoryRefreshFailed } from './notification.service';
import { nextCronTick } from './scheduler.service';
import { disableStoryDelivery, syncStoryDeliveryJob } from './story-delivery.service';
import { copyMcpQueriesToStory } from './story-sql-queries';

export interface StoryLiveSettings {
	isLive: boolean;
	isLiveTextDynamic: boolean;
	cacheSchedule: string | null;
	cacheScheduleDescription: string | null;
}

interface ManualRefreshOptions {
	/** Recorded as the one who refreshed; the queries still run as the story owner. */
	actorUserId: string;
	billingAccessVerifiedProjectId?: string;
}

export async function updateStoryLiveSettings(storyId: string, settings: StoryLiveSettings): Promise<void> {
	assertValidRefreshSchedule(settings.isLive, settings.cacheSchedule);
	if (settings.isLive) {
		await assertStoryCanGoLive(storyId);
	}
	await storyQueries.updateStoryLiveSettings(storyId, settings);
	await syncStoryScheduledJobs(storyId);
}

/** A standalone story that is not live shows its frozen snapshot, which a refresh would overwrite. */
export function assertStoryCanRefresh(story: Pick<DBStory, 'chatId' | 'isLive'>): void {
	if (!story.chatId && !story.isLive) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a live story can be refreshed.' });
	}
}

/** Realigns the refresh and delivery jobs of a story with its current settings. */
export async function syncStoryScheduledJobs(storyId: string): Promise<void> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story) {
		return;
	}
	await syncStoryRefreshJob(story);

	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	if (delivery) {
		await syncStoryDeliveryJob(storyId, story.isLive && delivery.enabled, delivery.cron);
	}
}

export async function unscheduleStoryRefreshJob(storyId: string): Promise<void> {
	const story = await storyQueries.getStoryById(storyId);
	if (story?.scheduledJobId) {
		await scheduledJobQueries.deleteJob(story.scheduledJobId);
		await activityQueries.linkStoryScheduledJob(storyId, null);
	}
	await disableStoryDelivery(storyId);
}

export async function refreshStoryManually(
	story: DBStory,
	options: ManualRefreshOptions,
): Promise<{ queryData: StoryQueryData; cachedAt: Date }> {
	assertStoryCanRefresh(story);
	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
	if (!projectId) {
		throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Story has no project.' });
	}
	const ownerId = story.userId ?? options.actorUserId;
	const activity = await activityQueries.startStoryRefreshActivity({
		projectId,
		userId: options.actorUserId,
		storyId: story.id,
		chatId: story.chatId,
		trigger: 'manual',
	});
	try {
		return await withKeyedLock(`story:${story.id}`, async () => {
			const { queryData, queriesRefreshed } = await refreshStoryById(story.id, {
				billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
			});
			await activityQueries.completeActivity(activity.id, { queriesRefreshed });
			if (queriesRefreshed > 0) {
				await notifyStoryRefreshed({
					projectId,
					ownerId,
					storyId: story.id,
					storyTitle: story.title,
					queriesRefreshed,
					trigger: 'manual',
				}).catch((notifyError) => {
					logger.error(`Failed to notify story refresh: ${String(notifyError)}`, {
						source: 'system',
						projectId,
						context: { storyId: story.id },
					});
				});
			}
			logAnalyticsEvent({
				projectId,
				type: 'refresh',
				assetType: 'story',
				actorUserId: options.actorUserId,
				storyId: story.id,
				chatId: story.chatId,
				metadata: { type: 'refresh', trigger: 'manual', queriesRefreshed },
			});
			return { queryData, cachedAt: new Date() };
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await activityQueries.failActivity(activity.id, message);
		await notifyStoryRefreshFailed({
			projectId,
			ownerId,
			storyId: story.id,
			storyTitle: story.title,
			errorMessage: message,
			trigger: 'manual',
		}).catch((notifyError) => {
			logger.error(`Failed to notify owner of manual refresh failure: ${String(notifyError)}`, {
				source: 'system',
				projectId,
				context: { storyId: story.id },
			});
		});
		throw err;
	}
}

async function assertStoryCanGoLive(storyId: string): Promise<void> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story) {
		return;
	}
	await saveMissingMcpQueries(story);
	if (!story.chatId && (await hasOnlyFrozenQueries(story))) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'This story has no saved queries to rerun, so its data cannot be refreshed.',
		});
	}
}

/** An MCP story saved before its SQL was kept with it can still find that SQL in its owner's MCP calls. */
async function saveMissingMcpQueries(story: DBStory): Promise<void> {
	const missingIds = await listQueryIdsWithoutSql(story);
	if (missingIds.size === 0) {
		return;
	}
	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
	const userId = story.userId ?? (await storyQueries.getStoryOwnerId(story.id));
	if (!projectId || !userId) {
		return;
	}
	await copyMcpQueriesToStory(story.id, missingIds, { projectId, userId });
}

/**
 * Validates the refresh schedule before touching the database so an invalid
 * cron cannot be persisted on the story row.
 */
function assertValidRefreshSchedule(isLive: boolean, cacheSchedule: string | null): void {
	if (!isLive || cacheSchedule === null || cacheSchedule === NO_CACHE_SCHEDULE) {
		return;
	}
	if (!nextCronTick(cacheSchedule, new Date())) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid cron expression for refresh schedule: ${cacheSchedule}`,
		});
	}
}

/**
 * Idempotently aligns the scheduled job for a live story with its current cache
 * settings. Live stories with a real cron schedule get a recurring job; manual,
 * no-cache, or disabled stories have their job removed.
 */
async function syncStoryRefreshJob(story: DBStory): Promise<void> {
	const { cacheSchedule } = story;
	const shouldSchedule = story.isLive && cacheSchedule !== null && cacheSchedule !== NO_CACHE_SCHEDULE;

	if (!shouldSchedule) {
		if (story.scheduledJobId) {
			await scheduledJobQueries.deleteJob(story.scheduledJobId);
			await activityQueries.linkStoryScheduledJob(story.id, null);
		}
		return;
	}

	const runAt = nextCronTick(cacheSchedule, new Date());
	if (!runAt) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid cron expression for refresh schedule: ${cacheSchedule}`,
		});
	}

	const job = await scheduledJobQueries.upsertRecurringJob({
		name: STORY_REFRESH_JOB_NAME,
		cron: cacheSchedule,
		uniqueKey: activityQueries.storyRefreshJobUniqueKey(story.id),
		payload: { storyId: story.id },
		runAt,
		status: 'pending',
		resetRunAtOnConflict: true,
	});
	await activityQueries.linkStoryScheduledJob(story.id, job.id);
}
