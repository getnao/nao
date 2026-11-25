import { getAutomation, getAutomationIdOfRunChat } from '../queries/automation.queries';
import { canUserAccessChat } from '../queries/chat.queries';
import { getUserRoleInProject, isProjectDeactivated } from '../queries/project.queries';

/**
 * Whoever can open the chat (owner or share recipient) can view its content, and so can the project admins who
 * replay it and the project members an automation is shared with, for the chats of its runs. Nobody can while its
 * project is deactivated.
 */
export async function canUserViewChatContent(chatId: string, chatProjectId: string, userId: string): Promise<boolean> {
	if (await isProjectDeactivated(chatProjectId)) {
		return false;
	}
	if (await canUserAccessChat(chatId, userId)) {
		return true;
	}
	const role = await getUserRoleInProject(chatProjectId, userId);
	if (role === 'admin' || role === 'context_admin') {
		return true;
	}
	return role !== null && canUserViewAutomationRunChat(chatId, chatProjectId, userId);
}

async function canUserViewAutomationRunChat(chatId: string, chatProjectId: string, userId: string): Promise<boolean> {
	const automationId = await getAutomationIdOfRunChat(chatId);
	if (!automationId) {
		return false;
	}
	return (await getAutomation(chatProjectId, userId, automationId, 'viewer')) !== null;
}
