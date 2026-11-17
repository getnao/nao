import type { UserRole } from '@nao/shared/types';

import * as chatQueries from '../queries/chat.queries';
import { HandlerError } from '../utils/error';

const CONTEXT_EDIT_CHAT_TITLE = 'Context Hub';

/** Opens a new chat beside the Context Hub, kept out of the chat history. */
export async function startContextEditChat({
	userId,
	projectId,
}: {
	userId: string;
	projectId: string;
}): Promise<{ chatId: string }> {
	const chat = await chatQueries.createForkedChat(
		{
			projectId,
			userId,
			title: CONTEXT_EDIT_CHAT_TITLE,
			forkMetadata: {
				type: chatQueries.CONTEXT_EDIT_FORK_TYPE,
				id: projectId,
				title: CONTEXT_EDIT_CHAT_TITLE,
				authorName: '',
			},
		},
		[],
	);
	return { chatId: chat.id };
}

/** Context files are only edited by the people who may edit them in the Context Hub, from its own chat. */
export async function assertCanEditContextFromChat(chatId: string | undefined, userRole: UserRole): Promise<void> {
	if (userRole !== 'admin' && userRole !== 'context_admin') {
		throw new HandlerError('FORBIDDEN', 'Only admins and context admins can edit the context.');
	}
	const forkMetadata = chatId ? await chatQueries.getForkMetadata(chatId) : null;
	if (forkMetadata?.type !== chatQueries.CONTEXT_EDIT_FORK_TYPE) {
		throw new HandlerError('BAD_REQUEST', 'The context can only be edited from the Context Hub chat.');
	}
}
