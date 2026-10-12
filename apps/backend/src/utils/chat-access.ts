import { canUserAccessChat } from '../queries/chat.queries';
import { getUserRoleInProject } from '../queries/project.queries';

/** Whoever can open the chat (owner or share recipient) can view its content, and so can the project admins who replay it. */
export async function canUserViewChatContent(chatId: string, chatProjectId: string, userId: string): Promise<boolean> {
	if (await canUserAccessChat(chatId, userId)) {
		return true;
	}
	const role = await getUserRoleInProject(chatProjectId, userId);
	return role === 'admin' || role === 'context_admin';
}
