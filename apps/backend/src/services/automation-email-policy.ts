import * as projectQueries from '../queries/project.queries';
import { getEmailDomain } from '../utils/utils';

export async function getDisallowedAutomationEmailRecipients(
	projectId: string,
	recipients: string[],
): Promise<string[]> {
	const emailSettings = await projectQueries.getAutomationEmailSettings(projectId);

	if (emailSettings.recipientPolicy === 'anyone') {
		return [];
	}

	const projectUsers = await projectQueries.listUsersWithProjectAccess(projectId);
	const memberEmails = new Set(projectUsers.map((user) => user.email.toLowerCase()));
	const allowedDomains = new Set(emailSettings.allowedDomains.map((domain) => domain.toLowerCase()));

	return recipients.filter((recipient) => {
		const normalizedRecipient = recipient.toLowerCase();

		if (memberEmails.has(normalizedRecipient)) {
			return false;
		}

		if (emailSettings.recipientPolicy === 'project-members') {
			return true;
		}

		const domain = getEmailDomain(normalizedRecipient);
		return !domain || !allowedDomains.has(domain);
	});
}
