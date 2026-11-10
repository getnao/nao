import type { StoryNarratives } from '@nao/shared/story-app';
import {
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
	type StoryRefreshNotificationPayload,
} from '@nao/shared/types';

import type { DBScheduledJob, DBStory, DBStoryDelivery } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';
import * as userQueries from '../queries/user.queries';
import { renderCustomStoryPdf } from '../services/custom-story-export';
import { hasRowSecurity, refreshStoryData, refreshStoryDataForDelivery } from '../services/live-story';
import { NotificationChannelDeliveryError, notifyUsers } from '../services/notification.service';
import { resolveDeliveryRecipientUserIds } from '../services/story-recipients';
import type { EmailAttachment } from '../types/email';
import type { ChannelDeliveryAttempt } from '../types/notification';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { buildStoryEmailHtml, buildStoryPdfAttachment } from '../utils/story-email';
import { storyPath } from '../utils/story-links';

export const STORY_DELIVERY_JOB_NAME = 'story.deliver';

type StoryQueryData = Record<string, { data: unknown[]; columns: string[] }>;

type StoryDeliveryJobPayload = {
	storyId?: string;
	recipientUserIds?: string[];
	skipDeliveries?: ChannelDeliveryAttempt[];
};

type DeliveryContext = {
	delivery: DBStoryDelivery;
	story: DBStory;
	projectId: string;
	recipientUserIds: string[];
};

export class StoryRecipientDeliveryError extends NotificationChannelDeliveryError {
	readonly failedRecipientUserIds: string[];

	constructor(
		succeeded: ChannelDeliveryAttempt[],
		failed: ChannelDeliveryAttempt[],
		failedRecipientUserIds: string[],
	) {
		super(succeeded, failed);
		this.name = 'StoryRecipientDeliveryError';
		this.message = `Failed to deliver story to ${failedRecipientUserIds.length} recipient(s).`;
		this.failedRecipientUserIds = failedRecipientUserIds;
	}
}

export async function storyDeliveryHandler(payload: StoryDeliveryJobPayload, job?: DBScheduledJob): Promise<void> {
	if (!payload.storyId) {
		throw new Error('storyId is required.');
	}
	const storyId = payload.storyId;
	const hasRetryState = payload.recipientUserIds !== undefined || payload.skipDeliveries !== undefined;
	const startsNewScheduledDelivery = job?.cron !== null && job?.cron !== undefined && job.attempts === 1;
	const previousSkips = startsNewScheduledDelivery ? [] : parseSkipDeliveries(payload.skipDeliveries);
	const recipientUserIds = startsNewScheduledDelivery ? undefined : payload.recipientUserIds;
	if (job && startsNewScheduledDelivery && hasRetryState) {
		await scheduledJobQueries.updateJobPayload(job.id, { storyId });
	}
	try {
		await runScheduledStoryDelivery(storyId, previousSkips, recipientUserIds);
		if (job && !startsNewScheduledDelivery && hasRetryState) {
			await scheduledJobQueries.updateJobPayload(job.id, { storyId });
		}
	} catch (error) {
		if (job && error instanceof NotificationChannelDeliveryError) {
			await scheduledJobQueries.updateJobPayload(job.id, {
				storyId,
				...(error instanceof StoryRecipientDeliveryError
					? { recipientUserIds: error.failedRecipientUserIds }
					: {}),
				skipDeliveries: mergeSkipDeliveries(previousSkips, error.succeeded),
			});
		}
		throw error;
	}
}

export async function resolveStoryDeliveryProjectId(payload: StoryDeliveryJobPayload): Promise<string | null> {
	if (!payload.storyId) {
		throw new Error('storyId is required.');
	}
	const story = await storyQueries.getStoryById(payload.storyId);
	if (!story) {
		return null;
	}
	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
	if (!projectId) {
		throw new Error(`Story ${payload.storyId} is missing a project; cannot deliver.`);
	}
	return projectId;
}

export async function runScheduledStoryDelivery(
	storyId: string,
	skipDeliveries: ChannelDeliveryAttempt[] = [],
	recipientUserIds?: string[],
): Promise<void> {
	await withKeyedLock(`story:${storyId}`, async () => {
		const context = await loadDeliveryContext(storyId, recipientUserIds);
		if (!context) {
			return;
		}
		if (await hasRowSecurity(context.story.chatId!)) {
			await deliverRecipientSnapshots(context, skipDeliveries);
			return;
		}
		const { queryData } = await refreshStoryData(context.story.chatId!, context.story.slug, {
			billingAccessVerifiedProjectId: context.projectId,
		});
		await deliver(context, queryData, skipDeliveries);
	});
}

export async function deliverStoryOnRefresh(
	storyId: string,
	refreshCron: string | null,
	queryData: StoryQueryData,
): Promise<void> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	if (!delivery || !delivery.enabled) {
		return;
	}
	const deliversOnRefresh = delivery.cron === null || delivery.cron === refreshCron;
	if (!deliversOnRefresh) {
		return;
	}

	const context = await loadDeliveryContext(storyId);
	if (context) {
		if (await hasRowSecurity(context.story.chatId!)) {
			await deliverRecipientSnapshots(context);
		} else {
			await deliver(context, queryData);
		}
	}
}

async function loadDeliveryContext(
	storyId: string,
	requestedRecipientUserIds?: string[],
): Promise<DeliveryContext | null> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	if (!delivery || !delivery.enabled) {
		return null;
	}

	const story = await storyQueries.getStoryById(storyId);
	if (!story || story.archivedAt) {
		return null;
	}
	if (!story.chatId) {
		throw new Error(`Story ${storyId} has no chat to regenerate for delivery.`);
	}

	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(storyId));
	if (!projectId) {
		throw new Error(`Story ${storyId} is missing a project; cannot deliver.`);
	}

	const resolvedRecipientUserIds = await resolveDeliveryRecipientUserIds(
		delivery,
		storyId,
		projectId,
		story.userId ?? null,
	);
	const requested = requestedRecipientUserIds ? new Set(requestedRecipientUserIds) : null;
	const recipientUserIds = requested
		? resolvedRecipientUserIds.filter((recipientUserId) => requested.has(recipientUserId))
		: resolvedRecipientUserIds;
	if (recipientUserIds.length === 0) {
		return null;
	}

	return { delivery, story, projectId, recipientUserIds };
}

async function deliverRecipientSnapshots(
	context: DeliveryContext,
	skipDeliveries: ChannelDeliveryAttempt[] = [],
): Promise<void> {
	const succeeded: ChannelDeliveryAttempt[] = [];
	const failed: ChannelDeliveryAttempt[] = [];
	const failedRecipientUserIds: string[] = [];
	for (const recipientUserId of context.recipientUserIds) {
		if (!(await projectQueries.getUserRoleInProject(context.projectId, recipientUserId))) {
			continue;
		}
		const skippedChannels = new Set(
			skipDeliveries.filter((attempt) => attempt.userId === recipientUserId).map((attempt) => attempt.channel),
		);
		if (context.delivery.channels.every((channel) => skippedChannels.has(channel))) {
			continue;
		}
		const pendingAttempts = context.delivery.channels
			.filter((channel) => !skippedChannels.has(channel))
			.map((channel) => ({ userId: recipientUserId, channel }));

		let snapshot: Awaited<ReturnType<typeof refreshStoryDataForDelivery>>;
		try {
			snapshot = await refreshStoryDataForDelivery(context.story.chatId!, context.story.slug, {
				billingAccessVerifiedProjectId: context.projectId,
				generateViewerCode: true,
				viewerUserId: recipientUserId,
			});
		} catch (error) {
			failedRecipientUserIds.push(recipientUserId);
			failed.push(...pendingAttempts);
			logRecipientDeliveryFailure(context, recipientUserId, 'refresh', error);
			continue;
		}

		try {
			await deliver(
				{ ...context, recipientUserIds: [recipientUserId] },
				snapshot.queryData,
				skipDeliveries,
				snapshot.code,
				snapshot.narratives,
			);
			succeeded.push(...pendingAttempts);
		} catch (error) {
			failedRecipientUserIds.push(recipientUserId);
			if (error instanceof NotificationChannelDeliveryError) {
				succeeded.push(...error.succeeded);
				failed.push(...error.failed);
			} else {
				failed.push(...pendingAttempts);
			}
			logRecipientDeliveryFailure(context, recipientUserId, 'send', error);
		}
	}

	if (failedRecipientUserIds.length > 0) {
		throw new StoryRecipientDeliveryError(mergeSkipDeliveries([], succeeded), mergeSkipDeliveries([], failed), [
			...new Set(failedRecipientUserIds),
		]);
	}
}

function logRecipientDeliveryFailure(
	context: DeliveryContext,
	recipientUserId: string,
	stage: 'refresh' | 'send',
	error: unknown,
): void {
	logger.error(`Failed to ${stage} story delivery for recipient: ${String(error)}`, {
		source: 'system',
		projectId: context.projectId,
		context: { storyId: context.story.id, recipientUserId, stage },
	});
}

async function deliver(
	context: DeliveryContext,
	queryData: StoryQueryData,
	skipDeliveries: ChannelDeliveryAttempt[] = [],
	code?: string,
	narratives?: StoryNarratives,
): Promise<void> {
	const { delivery, story, projectId } = context;
	const recipientUserIds = await filterCurrentProjectMembers(projectId, context.recipientUserIds);
	if (recipientUserIds.length === 0) {
		return;
	}

	const version = await storyQueries.getLatestVersionByChatAndSlug(story.chatId!, story.slug);
	if (!version) {
		throw new Error(`Story ${story.id} has no version to deliver.`);
	}

	const ownerId = story.userId ?? (await storyQueries.getStoryOwnerId(story.id)) ?? null;
	const ownerName = ownerId ? await userQueries.getUserName(ownerId) : null;
	await ensureRecipientsCanOpenStory(story.id, projectId, ownerId, recipientUserIds);
	const linkUrl = storyPath(story.id);
	const isCustom = story.format === 'custom';
	const renderedCode = code ?? version.code;
	const [attachments, storyEmail] = await Promise.all([
		isCustom
			? buildCustomStoryPdfAttachment(story, queryData, projectId, narratives)
			: buildStoryPdfAttachment(version.title, renderedCode, queryData, projectId),
		isCustom ? undefined : buildStoryEmailHtml(version.title, renderedCode, queryData, projectId),
	]);

	const payload: StoryRefreshNotificationPayload = {
		kind: 'story_refresh',
		storyId: story.id,
		status: 'refreshed',
		ownerName: ownerName ?? undefined,
		storyTitle: version.title,
	};

	const currentRecipientUserIds = await filterCurrentProjectMembers(projectId, recipientUserIds);
	if (currentRecipientUserIds.length === 0) {
		return;
	}
	await notifyUsers(
		currentRecipientUserIds,
		{
			category: 'story_refresh',
			title: version.title,
			body: ownerName
				? `The latest version of "${version.title}" by ${ownerName} is ready.`
				: `The latest version of the story "${version.title}" is ready.`,
			linkUrl,
			ctaLabel: 'Open story',
			channels: delivery.channels,
			projectId,
			emailAttachments: storyEmail ? [...attachments, ...storyEmail.images] : attachments,
			emailBodyHtml: storyEmail?.html,
			payload,
		},
		{ throwOnChannelError: true, skipDeliveries },
	);

	logger.info(`Delivered story ${story.id} to ${currentRecipientUserIds.length} recipient(s).`, {
		source: 'system',
		projectId,
		context: { storyId: story.id },
	});
}

async function filterCurrentProjectMembers(projectId: string, userIds: string[]): Promise<string[]> {
	const roles = await Promise.all(userIds.map((userId) => projectQueries.getUserRoleInProject(projectId, userId)));
	return userIds.filter((_userId, index) => roles[index] !== null);
}

async function buildCustomStoryPdfAttachment(
	story: DBStory,
	queryData: StoryQueryData,
	projectId: string,
	narratives?: StoryNarratives,
): Promise<EmailAttachment[]> {
	try {
		const { filename, buffer } = await renderCustomStoryPdf(story.chatId!, story.slug, queryData, narratives);
		return [{ filename, content: buffer, contentType: 'application/pdf' }];
	} catch (error) {
		logger.error(`Failed to build custom story PDF attachment: ${String(error)}`, {
			source: 'system',
			projectId,
			context: { storyId: story.id },
		});
		return [];
	}
}

async function ensureRecipientsCanOpenStory(
	storyId: string,
	projectId: string,
	ownerId: string | null,
	recipientUserIds: string[],
): Promise<void> {
	const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
	if (access) {
		await grantShareAccessToRecipients(access, recipientUserIds);
		return;
	}
	if (!ownerId) {
		return;
	}
	await sharedStoryQueries.createSharedStory(
		{ storyId, projectId, userId: ownerId, visibility: 'specific' },
		{ userIds: recipientUserIds },
	);
}

async function grantShareAccessToRecipients(
	access: sharedStoryQueries.StoryShareAccess,
	recipientUserIds: string[],
): Promise<void> {
	if (access.visibility !== 'specific') {
		return;
	}
	const missing = recipientUserIds.filter((id) => !access.allowedUserIds.includes(id));
	await sharedStoryQueries.addSharedStoryAllowedUsers(access.shareId, missing);
}

function parseSkipDeliveries(skipDeliveries: ChannelDeliveryAttempt[] | undefined): ChannelDeliveryAttempt[] {
	if (!Array.isArray(skipDeliveries)) {
		return [];
	}
	const channels = new Set<NotificationChannel>(NOTIFICATION_CHANNELS);
	return skipDeliveries.filter(
		(entry): entry is ChannelDeliveryAttempt =>
			!!entry && typeof entry === 'object' && typeof entry.userId === 'string' && channels.has(entry.channel),
	);
}

function mergeSkipDeliveries(
	previous: ChannelDeliveryAttempt[],
	newlySucceeded: ChannelDeliveryAttempt[],
): ChannelDeliveryAttempt[] {
	const key = (attempt: ChannelDeliveryAttempt): string => `${attempt.userId}:${attempt.channel}`;
	const merged = new Map<string, ChannelDeliveryAttempt>();
	for (const attempt of [...previous, ...newlySucceeded]) {
		merged.set(key(attempt), attempt);
	}
	return [...merged.values()];
}
