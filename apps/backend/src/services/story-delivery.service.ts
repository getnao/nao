import { NO_CACHE_SCHEDULE } from '@nao/shared';
import type { NotificationChannel } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { STORY_DELIVERY_JOB_NAME } from '../handlers/story-delivery.handler';
import * as notificationUnsubscribeQueries from '../queries/notification-unsubscribe.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';
import { buildStoryUnsubscribeScope } from './notification-unsubscribe';
import { nextCronTick } from './scheduler.service';

const SUBSCRIPTION_CHANNELS: NotificationChannel[] = ['email', 'slack'];

export function assertValidDeliverySchedule(
	enabled: boolean,
	cron: string | null,
	recipientMode: 'all' | 'specific',
	recipientUserIds: string[],
): void {
	if (!enabled) {
		return;
	}
	if (recipientMode === 'specific' && recipientUserIds.length === 0) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one recipient to schedule delivery.' });
	}
	if (cron !== null && !nextCronTick(cron, new Date())) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid cron expression for delivery schedule: ${cron}` });
	}
}

export async function syncStoryDeliveryJob(storyId: string, enabled: boolean, cron: string | null): Promise<void> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	const story = await storyQueries.getStoryById(storyId);

	const coincidesWithRefresh = cron !== null && Boolean(story?.isLive) && story?.cacheSchedule === cron;
	const shouldSchedule = enabled && cron !== null && cron !== NO_CACHE_SCHEDULE && !coincidesWithRefresh;

	if (!shouldSchedule) {
		if (delivery?.scheduledJobId) {
			await scheduledJobQueries.deleteJob(delivery.scheduledJobId);
			await storyDeliveryQueries.setScheduledJobId(storyId, null);
		}
		return;
	}

	const runAt = nextCronTick(cron!, new Date());
	if (!runAt) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid cron expression for delivery schedule: ${cron}` });
	}

	const job = await scheduledJobQueries.upsertRecurringJob({
		name: STORY_DELIVERY_JOB_NAME,
		cron: cron!,
		uniqueKey: `story-delivery:${storyId}`,
		payload: { storyId },
		runAt,
		status: 'pending',
		resetRunAtOnConflict: true,
	});
	await storyDeliveryQueries.setScheduledJobId(storyId, job.id);
}

export async function disableStoryDelivery(storyId: string): Promise<void> {
	await syncStoryDeliveryJob(storyId, false, null);
	await storyDeliveryQueries.setEnabled(storyId, false);
}

export async function teardownStoryDelivery(storyId: string): Promise<void> {
	await syncStoryDeliveryJob(storyId, false, null);
	await storyDeliveryQueries.disableAndResetRecipients(storyId);

	await Promise.all(
		SUBSCRIPTION_CHANNELS.map((channel) =>
			notificationUnsubscribeQueries.removeUnsubscribesForScope(buildStoryUnsubscribeScope(channel, storyId)),
		),
	);
}
