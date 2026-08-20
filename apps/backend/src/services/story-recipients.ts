import type { DBStoryDelivery } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';

/** Users subscribed to a story's scheduled delivery. Empty when delivery is disabled or unconfigured. */
export async function resolveDeliverySubscriberIds(storyId: string): Promise<string[]> {
	const delivery = await storyDeliveryQueries.getByStoryId(storyId);
	if (!delivery || !delivery.enabled) {
		return [];
	}
	const projectId = delivery.projectId ?? (await storyQueries.getStoryProjectId(storyId));
	if (!projectId) {
		return [];
	}
	const ownerId = (await storyQueries.getStoryOwnerId(storyId)) ?? null;
	return resolveDeliveryRecipientUserIds(delivery, storyId, projectId, ownerId);
}

export async function resolveDeliveryRecipientUserIds(
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
