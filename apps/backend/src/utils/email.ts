import { buildStoryShareUrl } from '@nao/shared/story-share';
import type { Visibility } from '@nao/shared/types';

import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import { emailService } from '../services/email';
import { buildSharedItemEmail } from './email-builders';

const itemUrls: Record<'story' | 'chat', (shareId: string, visibility?: Visibility) => string> = {
	story: (shareId, visibility = 'project') => buildStoryShareUrl(shareId, visibility, env.BETTER_AUTH_URL),
	chat: (shareId) => `${env.BETTER_AUTH_URL}/shared-chat/${shareId}`,
};

export async function notifySharedItemRecipients({
	projectId,
	sharerId,
	sharerName,
	shareId,
	itemLabel,
	itemTitle,
	visibility,
	allowedUserIds,
}: {
	projectId: string;
	sharerId: string;
	sharerName: string;
	shareId: string;
	itemLabel: 'story' | 'chat';
	itemTitle: string;
	visibility: Visibility;
	allowedUserIds?: string[];
}): Promise<void> {
	if (visibility === 'public') {
		return;
	}

	const itemUrl = itemUrls[itemLabel](shareId, visibility);
	const allMembers = await projectQueries.listAllUsersWithRoles(projectId);

	const recipients =
		visibility === 'project'
			? allMembers.filter((m) => m.id !== sharerId)
			: allMembers.filter((m) => allowedUserIds?.includes(m.id) && m.id !== sharerId);

	await Promise.all(
		recipients.map((recipient) =>
			emailService.sendEmail(
				recipient.email,
				buildSharedItemEmail(recipient, sharerName, itemLabel, itemTitle, itemUrl),
			),
		),
	);
}
