import type { DBScheduledJob, DBStory, DBStoryDelivery } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';
import { refreshStoryData } from '../services/live-story';
import { notifyUsers } from '../services/notification.service';
import { logger } from '../utils/logger';
import { buildStoryPdfAttachment } from '../utils/story-download';
import { sharedStoryPath, standaloneStoryPath } from '../utils/story-links';

export const STORY_DELIVERY_JOB_NAME = 'story.deliver';

type StoryQueryData = Record<string, { data: unknown[]; columns: string[] }>;

type StoryDeliveryJobPayload = {
	storyId?: string;
};

type DeliveryContext = {
	delivery: DBStoryDelivery;
	story: DBStory;
	projectId: string;
	recipientUserIds: string[];
};

export async function storyDeliveryHandler(payload: StoryDeliveryJobPayload, _job?: DBScheduledJob): Promise<void> {
	if (!payload.storyId) {
		throw new Error('storyId is required.');
	}
	await runScheduledStoryDelivery(payload.storyId);
}

export async function runScheduledStoryDelivery(storyId: string): Promise<void> {
	const context = await loadDeliveryContext(storyId);
	if (!context) {
		return;
	}
	const { queryData } = await refreshStoryData(context.story.chatId!, context.story.slug);
	await deliver(context, queryData);
}

export async function deliverStoryOnRefresh(
	storyId: string,
	trigger: 'manual' | 'schedule',
	refreshCron: string | null,
	queryData: StoryQueryData,
): Promise<void> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	if (!delivery || !delivery.enabled) {
		return;
	}
	const isManualMode = delivery.cron === null;
	const coincidesWithRefresh = delivery.cron !== null && delivery.cron === refreshCron;
	if (trigger === 'manual' ? !isManualMode : !coincidesWithRefresh) {
		return;
	}

	const context = await loadDeliveryContext(storyId);
	if (context) {
		await deliver(context, queryData);
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
	if (!story.chatId) {
		throw new Error(`Story ${storyId} has no chat to regenerate for delivery.`);
	}

	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(storyId));
	if (!projectId) {
		throw new Error(`Story ${storyId} is missing a project; cannot deliver.`);
	}

	const recipientUserIds = await resolveRecipientUserIds(delivery, storyId, projectId, story.userId ?? null);
	if (recipientUserIds.length === 0) {
		return null;
	}

	return { delivery, story, projectId, recipientUserIds };
}

async function deliver(context: DeliveryContext, queryData: StoryQueryData): Promise<void> {
	const { delivery, story, projectId, recipientUserIds } = context;

	const version = await storyQueries.getLatestVersionByChatAndSlug(story.chatId!, story.slug);
	if (!version) {
		throw new Error(`Story ${story.id} has no version to deliver.`);
	}

	const ownerId = story.userId ?? (await storyQueries.getStoryOwnerId(story.id)) ?? null;
	const linkUrl = await resolveStoryLink(story.id, projectId, ownerId, recipientUserIds);
	const attachments = await buildStoryPdfAttachment(version.title, version.code, queryData, projectId);

	await notifyUsers(recipientUserIds, {
		category: 'story_refresh',
		title: version.title,
		body: `The latest version of the story "${version.title}" is ready.`,
		linkUrl,
		ctaLabel: 'Open story',
		channels: delivery.channels,
		projectId,
		emailAttachments: attachments,
		payload: { storyId: story.id },
	});

	logger.info(`Delivered story ${story.id} to ${recipientUserIds.length} recipient(s).`, {
		source: 'system',
		projectId,
		context: { storyId: story.id },
	});
}

async function resolveRecipientUserIds(
	delivery: DBStoryDelivery,
	storyId: string,
	projectId: string,
	ownerId: string | null,
): Promise<string[]> {
	if (delivery.recipientMode !== 'all') {
		return delivery.recipientUserIds;
	}

	const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
	if (!access) {
		const members = await projectQueries.listProjectMembersWithRoles(projectId);
		return members.map((member) => member.id).filter((id) => id !== ownerId);
	}

	if (access.visibility === 'specific') {
		return access.allowedUserIds;
	}

	const members = await projectQueries.listUsersWithProjectAccess(projectId);
	return members.map((member) => member.id).filter((id) => id !== ownerId);
}

async function resolveStoryLink(
	storyId: string,
	projectId: string,
	ownerId: string | null,
	recipientUserIds: string[],
): Promise<string> {
	const existing = await sharedStoryQueries.getSharedStoryInfo(storyId, projectId);
	if (existing) {
		return sharedStoryPath(existing.id);
	}
	if (!ownerId) {
		return standaloneStoryPath(storyId);
	}
	const shared = await sharedStoryQueries.createSharedStory(
		{ storyId, projectId, userId: ownerId, visibility: 'specific' },
		recipientUserIds,
	);
	return sharedStoryPath(shared.id);
}
