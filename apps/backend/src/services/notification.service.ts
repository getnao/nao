import type {
	SharedItemLabel,
	SharedNotificationPayload,
	StoryRefreshNotificationPayload,
	StorySubscriptionNotificationPayload,
	Visibility,
} from '@nao/shared/types';

import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as userQueries from '../queries/user.queries';
import type { NotificationRecipient, NotifyInput } from '../types/notification';
import { buildSharedItemEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';
import { sharedStoryPath, standaloneStoryPath, storyPath } from '../utils/story-links';
import { notificationChannels } from './notification-channels';
import { resolveDeliverySubscriberIds } from './story-recipients';

const sharedItemPaths: Record<SharedItemLabel, (shareId: string) => string> = {
	story: (shareId) => sharedStoryPath(shareId),
	chat: (shareId) => `/shared-chat/${shareId}`,
};

export async function notify(input: NotifyInput): Promise<void> {
	const recipient = await resolveRecipient(input.userId);
	if (!recipient) {
		return;
	}
	await deliverToRecipient(recipient, input);
}

export async function notifyStoryRefreshed(params: {
	projectId: string;
	ownerId: string;
	storyId: string;
	storyTitle: string;
	queriesRefreshed: number;
	trigger: 'manual' | 'schedule';
}): Promise<void> {
	const userIds = await resolveDeliverySubscriberIds(params.storyId);
	if (userIds.length === 0) {
		return;
	}
	const linkUrl = await resolveStoryLink(params.storyId, params.projectId);
	const ownerName = await resolveOwnerName(params.ownerId);

	const payload: StoryRefreshNotificationPayload = {
		kind: 'story_refresh',
		storyId: params.storyId,
		status: 'refreshed',
		queriesRefreshed: params.queriesRefreshed,
		trigger: params.trigger,
		ownerName,
		storyTitle: params.storyTitle,
	};

	await notifyUsers(userIds, {
		category: 'story_refresh',
		title: params.storyTitle,
		body: `Re-ran ${params.queriesRefreshed} ${params.queriesRefreshed === 1 ? 'query' : 'queries'} against the latest data.`,
		linkUrl,
		ctaLabel: 'Open story',
		projectId: params.projectId,
		payload,
		channels: ['in_app'],
	});
}

export async function notifyStorySubscriptionAdded(params: {
	projectId: string;
	storyId: string;
	storyTitle: string;
	ownerName: string;
	addedUserIds: string[];
}): Promise<void> {
	if (params.addedUserIds.length === 0) {
		return;
	}
	const access = await sharedStoryQueries.getStoryShareAccess(params.storyId, params.projectId);
	const linkUrl = storyPath(access ? { id: access.shareId } : null, params.storyId);

	const payload: StorySubscriptionNotificationPayload = {
		kind: 'story_subscription',
		storyId: params.storyId,
		storyTitle: params.storyTitle,
		ownerName: params.ownerName,
		shareId: access?.shareId ?? null,
	};

	await notifyUsers(params.addedUserIds, {
		category: 'subscription',
		title: params.storyTitle,
		body: `${params.ownerName} subscribed you to the scheduled delivery for this story.`,
		linkUrl,
		ctaLabel: 'Open story',
		projectId: params.projectId,
		payload,
		channels: ['in_app'],
	});
}

export async function notifyStoryRefreshFailed(params: {
	projectId: string;
	ownerId: string;
	storyId: string;
	storyTitle: string;
	errorMessage: string;
	trigger: 'manual' | 'schedule';
}): Promise<void> {
	const payload: StoryRefreshNotificationPayload = {
		kind: 'story_refresh',
		storyId: params.storyId,
		status: 'failed',
		trigger: params.trigger,
	};
	const title =
		params.trigger === 'schedule'
			? `Scheduled refresh failed: ${params.storyTitle}`
			: `Refresh failed: ${params.storyTitle}`;
	await notify({
		userId: params.ownerId,
		projectId: params.projectId,
		category: 'story_refresh',
		title,
		body: params.errorMessage,
		linkUrl: standaloneStoryPath(params.storyId),
		ctaLabel: 'Open story',
		payload,
	});
}

export async function notifyUsers(
	userIds: string[],
	input: Omit<NotifyInput, 'userId'>,
	options: DeliveryOptions = {},
): Promise<void> {
	if (userIds.length === 0) {
		return;
	}
	const recipients = await userQueries.getUsersByIds(userIds);
	await Promise.all(
		recipients.map((recipient) => deliverToRecipient(recipient, { ...input, userId: recipient.id }, options)),
	);
}

export async function notifySharedItem(params: {
	projectId: string;
	sharerId: string;
	sharerName: string;
	shareId: string;
	itemLabel: SharedItemLabel;
	itemTitle: string;
	visibility: Visibility;
	allowedUserIds?: string[];
	deliverExternally?: boolean;
}): Promise<void> {
	const recipientIds = await resolveSharedItemRecipientIds(params);
	if (recipientIds.length === 0) {
		return;
	}

	const linkUrl = sharedItemPaths[params.itemLabel](params.shareId);
	const itemUrl = toAbsoluteShareUrl(linkUrl);

	const payload: SharedNotificationPayload = {
		kind: 'shared',
		sharerName: params.sharerName,
		itemLabel: params.itemLabel,
		itemTitle: params.itemTitle,
		visibility: params.visibility,
	};

	await notifyUsers(recipientIds, {
		category: 'shared',
		title: `${params.sharerName} shared a ${params.itemLabel} with you`,
		body: `"${params.itemTitle}"`,
		linkUrl,
		ctaLabel: `Open ${params.itemLabel}`,
		projectId: params.projectId,
		payload,
		channels: params.deliverExternally === false ? ['in_app'] : undefined,
		emailOverride: (recipient, unsubscribeUrl) =>
			buildSharedItemEmail(
				recipient,
				params.sharerName,
				params.itemLabel,
				params.itemTitle,
				itemUrl,
				unsubscribeUrl,
			),
	});
}

async function resolveStoryLink(storyId: string, projectId: string): Promise<string> {
	const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
	return storyPath(access ? { id: access.shareId } : null, storyId);
}

async function resolveOwnerName(ownerId: string): Promise<string | undefined> {
	return (await userQueries.getUserName(ownerId)) ?? undefined;
}

async function resolveSharedItemRecipientIds(params: {
	projectId: string;
	sharerId: string;
	visibility: Visibility;
	allowedUserIds?: string[];
}): Promise<string[]> {
	const members = await projectQueries.listUsersWithProjectAccess(params.projectId);
	const allowed = new Set(params.allowedUserIds ?? []);
	return members
		.filter((member) => member.id !== params.sharerId)
		.filter((member) => params.visibility === 'project' || allowed.has(member.id))
		.map((member) => member.id);
}

function toAbsoluteShareUrl(linkUrl: string): string {
	return `${env.BETTER_AUTH_URL.replace(/\/$/, '')}${linkUrl}`;
}

/** Options controlling how channel delivery failures are handled. */
type DeliveryOptions = {
	/**
	 * When true, throws after attempting all channels if any failed. Callers that
	 * back a retry (e.g. scheduled story delivery) rely on this to surface send
	 * failures; the default swallows them so best-effort notifications never fail.
	 */
	throwOnChannelError?: boolean;
};

async function deliverToRecipient(
	recipient: NotificationRecipient,
	input: NotifyInput,
	options: DeliveryOptions = {},
): Promise<void> {
	const targets = notificationChannels.filter((channel) => {
		if (input.channels && !input.channels.includes(channel.id)) {
			return false;
		}
		return channel.isEnabled();
	});

	const results = await Promise.allSettled(
		targets.map((channel) =>
			channel.deliver(recipient, {
				category: input.category,
				title: input.title,
				body: input.body,
				linkUrl: input.linkUrl,
				ctaLabel: input.ctaLabel,
				payload: input.payload,
				projectId: input.projectId,
				emailAttachments: input.emailAttachments,
				emailBodyHtml: input.emailBodyHtml,
				emailOverride: input.emailOverride,
			}),
		),
	);

	const failures: unknown[] = [];
	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			failures.push(result.reason);
			logger.error(
				`Failed to deliver ${input.category} notification via ${targets[index].id}: ${String(result.reason)}`,
				{
					source: 'system',
					context: { userId: recipient.id, channel: targets[index].id },
				},
			);
		}
	});

	if (options.throwOnChannelError && failures.length > 0) {
		throw new Error(
			`Failed to deliver ${input.category} notification on ${failures.length} channel(s): ${failures
				.map((failure) => String(failure))
				.join('; ')}`,
		);
	}
}

async function resolveRecipient(userId: string): Promise<NotificationRecipient | null> {
	const user = await userQueries.getUser({ id: userId });
	return user ? { id: user.id, name: user.name, email: user.email } : null;
}
