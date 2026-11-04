import * as projectQueries from '../queries/project.queries';

export async function getNonMemberAutomationEmailRecipients(
	projectId: string,
	recipients: string[],
): Promise<string[]> {
	const projectUsers = await projectQueries.listUsersWithProjectAccess(projectId);
	const memberEmails = new Set(projectUsers.map((user) => user.email.toLowerCase()));
	return recipients.filter((recipient) => !memberEmails.has(recipient.toLowerCase()));
}
