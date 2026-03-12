import type { User } from 'better-auth';

import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import { emailService } from '../services/email';

export async function notifySharedStoryRecipients({
	projectId,
	sharerId,
	sharerName,
	shareId,
	storyTitle,
	visibility,
	allowedUserIds,
}: {
	projectId: string;
	sharerId: string;
	sharerName: string;
	shareId: string;
	storyTitle: string;
	visibility: 'project' | 'specific';
	allowedUserIds?: string[];
}): Promise<void> {
	const storyUrl = `${env.BETTER_AUTH_URL || 'http://localhost:3000'}/stories/shared/${shareId}`;
	const allMembers = await projectQueries.getAllUsersWithRoles(projectId);

	const recipients =
		visibility === 'project'
			? allMembers.filter((m) => m.id !== sharerId)
			: allMembers.filter((m) => allowedUserIds?.includes(m.id) && m.id !== sharerId);

	await Promise.all(
		recipients.map((recipient) =>
			emailService.sendEmail({
				user: { id: recipient.id, name: recipient.name, email: recipient.email } as User,
				type: 'sharedStory',
				sharerName,
				storyTitle,
				storyUrl,
			}),
		),
	);
}
