import * as chatQueries from '../queries/chat.queries';
import { AgentRequest } from '../routes/agent';
import { agentService } from '../services/agent.service';
import { mcpService } from '../services/mcp.service';
import { skillService } from '../services/skill.service';
import { UIMessage } from '../types/chat';
import { createChatTitle } from '../utils/ai';
import { HandlerError } from '../utils/error';

interface HandleAgentMessageInput extends AgentRequest {
	userId: string;
	projectId: string | undefined;
}

interface HandleAgentMessageResult {
	chatId: string;
	isNewChat: boolean;
	modelId: string;
	stream: ReadableStream;
}

export const handleAgentRoute = async (input: HandleAgentMessageInput): Promise<HandleAgentMessageResult> => {
	const { userId, message, messageToEditId, model, mentions, projectId } = input;

	if (!projectId) {
		throw new HandlerError(
			'BAD_REQUEST',
			'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.',
		);
	}

	let chatId = input.chatId;
	const isNewChat = !chatId;
	let newMessageId: string;

	if (!chatId) {
		const [createdChat, createdMessage] = await createChat(userId, projectId, message);
		chatId = createdChat.id;
		newMessageId = createdMessage.id;
	} else {
		const { messageId } = await insertOrSupersedeMessage(chatId, message, messageToEditId);
		newMessageId = messageId;
	}

	const [chat, chatUserId] = await chatQueries.loadChat(chatId);
	if (!chat) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
	}

	if (chatUserId !== userId) {
		throw new HandlerError('FORBIDDEN', 'You are not authorized to access this chat.');
	}

	await mcpService.initializeMcpState(projectId);
	await skillService.initializeSkills(projectId);

	const agent = await agentService.create({ ...chat, userId, projectId }, model);

	const stream = agent.stream(chat.messages, {
		mentions,
		events: {
			newChat: isNewChat
				? {
						id: chatId,
						title: chat.title,
						createdAt: chat.createdAt,
						updatedAt: chat.updatedAt,
					}
				: undefined,
			newUserMessage: { clientId: message.id, newId: newMessageId },
		},
	});

	return {
		chatId,
		isNewChat,
		modelId: agent.getModelId(),
		stream,
	};
};

const createChat = async (userId: string, projectId: string, message: UIMessage) => {
	const title = createChatTitle(message);
	return await chatQueries.createChat({ title, userId, projectId }, message);
};

/** Insert a message into a chat or supersede an existing message when it is edited. */
const insertOrSupersedeMessage = async (chatId: string, message: UIMessage, messageToEditId?: string) => {
	const doesChatExist = await chatQueries.checkChatExists(chatId);
	if (!doesChatExist) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
	}
	if (messageToEditId) {
		await chatQueries.supersedeMessagesFrom(chatId, messageToEditId);
	}
	return chatQueries.upsertMessage(message, { chatId });
};
