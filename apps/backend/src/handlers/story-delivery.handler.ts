import type { StoryNarratives } from '@nao/shared/story-app';
import { prepareRestrictedStoryCode } from '@nao/shared/story-viewer-restrictions';
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
import * as storyFolderQueries from '../queries/story-folder.queries';
import * as userQueries from '../queries/user.queries';
import { renderCustomStoryPdf } from '../services/custom-story-export';
import { omitAccessDeniedQueries, refreshStoryById, refreshStoryForViewer } from '../services/live-story';
import { NotificationChannelDeliveryError, notifyUsers } from '../services/notification.service';
import { resolveDeliveryRecipientUserIds } from '../services/story-recipients';
import { hasEffectiveWarehouseRestrictions } from '../services/user-group-context-access.service';
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
	skipDeliveries?: ChannelDeliveryAttempt[];
};

type DeliveryContext = {
	delivery: DBStoryDelivery;
	story: DBStory;
	projectId: string;
	recipientUserIds: string[];
};

/** What a delivery shows; the latest version's code and the story's cached narratives unless given. */
type DeliveryContent = {
	queryData: StoryQueryData;
	code?: string;
	narratives?: StoryNarratives;
};

export async function storyDeliveryHandler(payload: StoryDeliveryJobPayload, job?: DBScheduledJob): Promise<void> {
	if (!payload.storyId) {
		throw new Error('storyId is required.');
	}
	const storyId = payload.storyId;
	const previousSkips = parseSkipDeliveries(payload.skipDeliveries);
	try {
		await runScheduledStoryDelivery(storyId, previousSkips);
	} catch (error) {
		const isLastAttempt = !!job && job.attempts >= job.maxAttempts;
		const succeeded = error instanceof NotificationChannelDeliveryError ? error.succeeded : [];
		await saveRetrySkips(job, storyId, isLastAttempt ? [] : mergeSkipDeliveries(previousSkips, succeeded));
		throw error;
	}
	if (previousSkips.length > 0) {
		await saveRetrySkips(job, storyId, []);
	}
}

/**
 * What a run already sent is skipped by its retries only. The payload belongs to the recurring job, so the list is
 * cleared once the run succeeds or gives up, or every later run would skip the same recipients.
 */
async function saveRetrySkips(
	job: DBScheduledJob | undefined,
	storyId: string,
	skipDeliveries: ChannelDeliveryAttempt[],
): Promise<void> {
	if (job) {
		await scheduledJobQueries.updateJobPayload(
			job.id,
			skipDeliveries.length > 0 ? { storyId, skipDeliveries } : { storyId },
		);
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
): Promise<void> {
	await withKeyedLock(`story:${storyId}`, async () => {
		const context = await loadDeliveryContext(storyId);
		if (!context) {
			return;
		}
		const { queryData } = await refreshStoryById(storyId, {
			billingAccessVerifiedProjectId: context.projectId,
		});
		await deliverToRecipients(context, queryData, skipDeliveries);
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
		await deliverToRecipients(context, queryData);
	}
}

async function loadDeliveryContext(storyId: string): Promise<DeliveryContext | null> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	if (!delivery || !delivery.enabled) {
		return null;
	}

	const story = await storyQueries.getStoryById(storyId);
	if (!story || story.archivedAt) {
		return null;
	}

	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(storyId));
	if (!projectId) {
		throw new Error(`Story ${storyId} is missing a project; cannot deliver.`);
	}

	const recipientUserIds = await filterCurrentProjectMembers(
		projectId,
		await resolveDeliveryRecipientUserIds(delivery, storyId, projectId, story.userId ?? null),
	);
	if (recipientUserIds.length === 0) {
		return null;
	}

	return { delivery, story, projectId, recipientUserIds };
}

/**
 * Recipients who read the story with its owner's access share the copy that was just refreshed. One whose warehouse
 * access is restricted gets a copy rebuilt with their own, and a failure for one recipient does not hold back the rest.
 */
async function deliverToRecipients(
	context: DeliveryContext,
	queryData: StoryQueryData,
	skipDeliveries: ChannelDeliveryAttempt[] = [],
): Promise<void> {
	const restrictedUserIds = await listRestrictedRecipientIds(context);
	if (restrictedUserIds.length === 0) {
		await deliver(context, { queryData }, skipDeliveries);
		return;
	}

	const unrestrictedUserIds = context.recipientUserIds.filter((userId) => !restrictedUserIds.includes(userId));
	const outcomes = [await attemptDelivery(context, unrestrictedUserIds, skipDeliveries, async () => ({ queryData }))];
	for (const userId of restrictedUserIds) {
		outcomes.push(
			await attemptDelivery(context, [userId], skipDeliveries, () =>
				buildRestrictedRecipientContent(context, userId),
			),
		);
	}

	const failed = outcomes.flatMap((outcome) => outcome.failed);
	if (failed.length > 0) {
		throw new NotificationChannelDeliveryError(
			outcomes.flatMap((outcome) => outcome.succeeded),
			failed,
		);
	}
}

async function listRestrictedRecipientIds(context: DeliveryContext): Promise<string[]> {
	const ownerId = context.story.userId ?? (await storyQueries.getStoryOwnerId(context.story.id));
	const isRestricted = await Promise.all(
		context.recipientUserIds.map(
			async (userId) =>
				userId !== ownerId && (await hasEffectiveWarehouseRestrictions(context.projectId, userId)),
		),
	);
	return context.recipientUserIds.filter((_userId, index) => isRestricted[index]);
}

async function buildRestrictedRecipientContent(context: DeliveryContext, userId: string): Promise<DeliveryContent> {
	const snapshot = await refreshStoryForViewer(context.story, userId, {
		billingAccessVerifiedProjectId: context.projectId,
	});
	return {
		queryData: omitAccessDeniedQueries(snapshot.queryData),
		code: prepareRestrictedStoryCode(snapshot.code).code,
		narratives: snapshot.narratives,
	};
}

type DeliveryOutcome = Pick<NotificationChannelDeliveryError, 'succeeded' | 'failed'>;

async function attemptDelivery(
	context: DeliveryContext,
	recipientUserIds: string[],
	skipDeliveries: ChannelDeliveryAttempt[],
	buildContent: () => Promise<DeliveryContent>,
): Promise<DeliveryOutcome> {
	const skipped = new Set(skipDeliveries.map(deliveryAttemptKey));
	const pending = recipientUserIds
		.flatMap((userId) => context.delivery.channels.map((channel) => ({ userId, channel })))
		.filter((attempt) => !skipped.has(deliveryAttemptKey(attempt)));
	if (pending.length === 0) {
		return { succeeded: [], failed: [] };
	}
	try {
		await deliver({ ...context, recipientUserIds }, await buildContent(), skipDeliveries);
		return { succeeded: pending, failed: [] };
	} catch (error) {
		logger.error(`Failed to deliver story to ${recipientUserIds.length} recipient(s): ${String(error)}`, {
			source: 'system',
			projectId: context.projectId,
			context: { storyId: context.story.id, recipientUserIds },
		});
		return error instanceof NotificationChannelDeliveryError ? error : { succeeded: [], failed: pending };
	}
}

async function deliver(
	context: DeliveryContext,
	content: DeliveryContent,
	skipDeliveries: ChannelDeliveryAttempt[] = [],
): Promise<void> {
	const { delivery, story, projectId, recipientUserIds } = context;
	const { queryData, narratives } = content;

	const version = await storyQueries.getLatestVersionByStoryId(story.id);
	if (!version) {
		throw new Error(`Story ${story.id} has no version to deliver.`);
	}

	const ownerId = story.userId ?? (await storyQueries.getStoryOwnerId(story.id)) ?? null;
	const ownerName = ownerId ? await userQueries.getUserName(ownerId) : null;
	const openingRecipientUserIds = await ensureRecipientsCanOpenStory(story.id, projectId, ownerId, recipientUserIds);
	if (openingRecipientUserIds.length === 0) {
		return;
	}
	const linkUrl = storyPath(story.id);
	const isCustom = story.format === 'custom';
	const renderedCode = content.code ?? version.code;
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

	const currentRecipientUserIds = await filterCurrentProjectMembers(projectId, openingRecipientUserIds);
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
		const { filename, buffer } = await renderCustomStoryPdf(story.id, queryData, narratives);
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

/**
 * A delivery shares the story with its recipients, except in a team folder: there the folder decides who sees the
 * story, so the delivery reaches only the people who can already open it, checked right before sending.
 */
async function ensureRecipientsCanOpenStory(
	storyId: string,
	projectId: string,
	ownerId: string | null,
	recipientUserIds: string[],
): Promise<string[]> {
	if (await isFiledInTeamFolder(storyId)) {
		return listRecipientsWhoCanOpenStory(storyId, ownerId, recipientUserIds);
	}
	const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
	if (access) {
		await grantShareAccessToRecipients(access, recipientUserIds);
		return recipientUserIds;
	}
	if (ownerId) {
		await sharedStoryQueries.createSharedStory(
			{ storyId, projectId, userId: ownerId, visibility: 'specific' },
			{ userIds: recipientUserIds },
		);
	}
	return recipientUserIds;
}

async function isFiledInTeamFolder(storyId: string): Promise<boolean> {
	const folderItem = await storyFolderQueries.getStoryFolderItem(storyId);
	return folderItem !== null && (await storyFolderQueries.findTeamFolderOf(folderItem.folderId)) !== null;
}

async function listRecipientsWhoCanOpenStory(
	storyId: string,
	ownerId: string | null,
	recipientUserIds: string[],
): Promise<string[]> {
	const canOpen = await Promise.all(
		recipientUserIds.map(
			async (userId) =>
				userId === ownerId || (await sharedStoryQueries.getStoryShareRole(storyId, userId)) !== null,
		),
	);
	return recipientUserIds.filter((_userId, index) => canOpen[index]);
}

async function grantShareAccessToRecipients(
	access: sharedStoryQueries.StoryShareAccess,
	recipientUserIds: string[],
): Promise<void> {
	if (access.visibility !== 'specific') {
		return;
	}
	const missing = recipientUserIds.filter((id) => !access.recipientUserIds.includes(id));
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
	const merged = new Map<string, ChannelDeliveryAttempt>();
	for (const attempt of [...previous, ...newlySucceeded]) {
		merged.set(deliveryAttemptKey(attempt), attempt);
	}
	return [...merged.values()];
}

function deliveryAttemptKey(attempt: ChannelDeliveryAttempt): string {
	return `${attempt.userId}:${attempt.channel}`;
}
