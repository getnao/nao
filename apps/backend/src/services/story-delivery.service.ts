import { NO_CACHE_SCHEDULE, type RecipientMode } from '@nao/shared';
import type { NotificationChannel } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { DBStory } from '../db/abstractSchema';
import { STORY_DELIVERY_JOB_NAME } from '../handlers/story-delivery.handler';
import * as notificationUnsubscribeQueries from '../queries/notification-unsubscribe.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { logger } from '../utils/logger';
import { notifyStorySubscriptionAdded } from './notification.service';
import {
	assertAudienceIncludes,
	assertAudienceIncludesProject,
	getShareAudience,
	listShareableGroups,
	type ShareAudience,
} from './project-sharing.service';
import { nextCronTick } from './scheduler.service';
import { assertShareableUserGroupIds } from './shareable-user-groups.service';
import { resolveSpecificRecipientUserIds } from './story-recipients';

export interface StoryDeliverySettings {
	enabled: boolean;
	cron: string | null;
	scheduleDescription: string | null;
	channels: NotificationChannel[];
	recipientMode: RecipientMode;
	recipientUserIds: string[];
	recipientGroupIds: string[];
}

interface DeliveryRecipient {
	id: string;
	name: string;
	email: string;
}

export async function getStoryDeliverySettings(storyId: string): Promise<StoryDeliverySettings> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	return {
		enabled: delivery?.enabled ?? false,
		cron: delivery?.cron ?? null,
		scheduleDescription: delivery?.scheduleDescription ?? null,
		channels: delivery?.channels ?? ['email'],
		recipientMode: delivery?.recipientMode ?? 'specific',
		recipientUserIds: delivery?.recipientUserIds ?? [],
		recipientGroupIds: delivery?.recipientGroupIds ?? [],
	};
}

/** A story shared with specific people is delivered to them only; otherwise to anyone the owner can share with. */
export async function listStoryDeliveryRecipients(storyId: string, ownerId: string): Promise<DeliveryRecipient[]> {
	const projectId = await storyQueries.getStoryProjectId(storyId);
	if (!projectId) {
		return [];
	}
	const [access, projectMembers, audience] = await Promise.all([
		sharedStoryQueries.getStoryShareAccess(storyId, projectId),
		projectQueries.listProjectMembersWithRoles(projectId),
		getShareAudience(projectId, ownerId),
	]);
	const members = projectMembers.filter((member) => audience.memberIds.has(member.id));
	const toRecipient = (member: (typeof members)[number]) => {
		return { id: member.id, name: member.name, email: member.email };
	};

	if (access?.visibility === 'specific' && access.recipientUserIds.length > 0) {
		const allowed = new Set([...access.recipientUserIds, ownerId]);
		return members.filter((member) => allowed.has(member.id)).map(toRecipient);
	}
	return members.map(toRecipient);
}

export async function listStoryDeliveryRecipientGroups(storyId: string, ownerId: string) {
	const projectId = await storyQueries.getStoryProjectId(storyId);
	return projectId ? listShareableGroups(projectId, ownerId) : [];
}

export async function updateStoryDelivery(
	story: DBStory,
	settings: StoryDeliverySettings,
	owner: { id: string; name: string },
): Promise<void> {
	if (settings.enabled && !story.isLive) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Scheduled delivery is only available for live stories.',
		});
	}
	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
	assertValidDeliverySchedule(
		settings.enabled,
		settings.cron,
		settings.recipientMode,
		settings.recipientUserIds,
		settings.recipientGroupIds,
	);

	const existingDelivery = await storyDeliveryQueries.getByStoryId(story.id);
	const previousRecipientIds = new Set(
		existingDelivery?.recipientMode === 'specific' && projectId
			? await resolveSpecificRecipientUserIds(
					projectId,
					existingDelivery.recipientUserIds,
					existingDelivery.recipientGroupIds,
				)
			: [],
	);

	if (settings.recipientMode === 'specific' && settings.recipientUserIds.length > 0) {
		if (!projectId) {
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Story has no project.' });
		}
		const allowedIds = new Set(
			(await projectQueries.listUsersWithProjectAccess(projectId)).map((member) => member.id),
		);
		if (settings.recipientUserIds.some((id) => !allowedIds.has(id))) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Recipients must have access to this project.',
			});
		}
	}
	if (settings.recipientMode === 'specific' && settings.recipientGroupIds.length > 0) {
		if (!projectId) {
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Story has no project.' });
		}
		await assertShareableUserGroupIds(projectId, settings.recipientGroupIds);
	}

	if (settings.enabled && projectId) {
		const audience = await getShareAudience(projectId, owner.id);
		await assertDeliveryWithinShareAudience(
			story.id,
			projectId,
			audience,
			settings,
			existingDelivery?.enabled && existingDelivery.recipientMode === 'specific' ? existingDelivery : null,
		);
		if (audience.canShareToProject) {
			const sharedInfo = await sharedStoryQueries.getSharedStoryInfo(story.id, projectId);
			if (!sharedInfo) {
				await storyFolderQueries.moveStoryToFolder(story.id, null, {
					storyOwnerId: owner.id,
					projectId,
				});
			}
		}
	}

	await storyDeliveryQueries.upsert({
		storyId: story.id,
		projectId,
		enabled: settings.enabled,
		cron: settings.cron,
		scheduleDescription: settings.scheduleDescription,
		channels: settings.channels,
		recipientMode: settings.recipientMode,
		recipientUserIds: settings.recipientUserIds,
		recipientGroupIds: settings.recipientMode === 'specific' ? settings.recipientGroupIds : [],
		createdBy: owner.id,
	});
	await syncStoryDeliveryJob(story.id, settings.enabled, settings.cron);

	if (settings.enabled && settings.recipientMode === 'specific' && projectId) {
		const bestEffortNotify = async () => {
			const recipientIds = await resolveSpecificRecipientUserIds(
				projectId,
				settings.recipientUserIds,
				settings.recipientGroupIds,
			);
			const addedUserIds = recipientIds.filter((id) => id !== owner.id && !previousRecipientIds.has(id));
			await notifyStorySubscribers(story.id, projectId, owner.name, addedUserIds);
		};
		await bestEffortNotify().catch((error) => {
			logger.error(`Failed to notify story subscribers: ${String(error)}`, {
				source: 'system',
				projectId,
				context: { storyId: story.id },
			});
		});
	}
}

export function assertValidDeliverySchedule(
	enabled: boolean,
	cron: string | null,
	recipientMode: RecipientMode,
	recipientUserIds: string[],
	recipientGroupIds: string[],
): void {
	if (!enabled) {
		return;
	}
	if (recipientMode === 'specific' && recipientUserIds.length === 0 && recipientGroupIds.length === 0) {
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
	await storyDeliveryQueries.disableAndResetRecipients([storyId]);
	await notificationUnsubscribeQueries.removeUnsubscribesForStory(storyId);
}

async function notifyStorySubscribers(
	storyId: string,
	projectId: string,
	ownerName: string,
	addedUserIds: string[],
): Promise<void> {
	if (addedUserIds.length === 0) {
		return;
	}
	const version = await storyQueries.getLatestVersionByStoryId(storyId);
	if (!version) {
		return;
	}
	await grantSpecificShareAccess(storyId, projectId, addedUserIds);
	await notifyStorySubscriptionAdded({
		projectId,
		storyId,
		storyTitle: version.title,
		ownerName,
		addedUserIds,
	});
}

async function grantSpecificShareAccess(storyId: string, projectId: string, userIds: string[]): Promise<void> {
	const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
	if (access?.visibility !== 'specific') {
		return;
	}
	const missing = userIds.filter((id) => !access.allowedUserIds.includes(id));
	await sharedStoryQueries.addSharedStoryAllowedUsers(access.shareId, missing);
}

/**
 * Delivering to "all" reaches the whole project unless the story is already limited to specific people.
 * Recipients of the currently active specific delivery stay allowed so restricted owners can keep editing it.
 */
async function assertDeliveryWithinShareAudience(
	storyId: string,
	projectId: string,
	audience: ShareAudience,
	delivery: { recipientMode: RecipientMode; recipientUserIds: string[]; recipientGroupIds: string[] },
	activeSpecificDelivery: { recipientUserIds: string[]; recipientGroupIds: string[] } | null,
): Promise<void> {
	if (audience.canShareToProject) {
		return;
	}
	if (delivery.recipientMode === 'all') {
		const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
		if (access?.visibility !== 'specific') {
			assertAudienceIncludesProject(audience);
		}
		return;
	}
	assertAudienceIncludes(audience, {
		userIds: delivery.recipientUserIds.filter((id) => !activeSpecificDelivery?.recipientUserIds.includes(id)),
		groupIds: delivery.recipientGroupIds.filter((id) => !activeSpecificDelivery?.recipientGroupIds.includes(id)),
	});
}
