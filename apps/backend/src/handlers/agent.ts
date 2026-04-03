import type { ImageUploadData } from '@nao/shared/types';

import * as chatQueries from '../queries/chat.queries';
import * as imageQueries from '../queries/image.queries';
import { agentService } from '../services/agent';
import { mcpService } from '../services/mcp';
import { skillService } from '../services/skill';
import { AgentRequest, AgentRequestUserMessage, UIMessagePart } from '../types/chat';
import { createChatTitle } from '../utils/ai';
import { HandlerError } from '../utils/error';
import { buildImageUrl } from '../utils/image';

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

export const handleAgentRoute = async (opts: HandleAgentMessageInput): Promise<HandleAgentMessageResult> => {
	const { userId, message, messageToEditId, model, mentions, projectId } = opts;

	if (!projectId) {
		throw new HandlerError(
			'BAD_REQUEST',
			'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.',
		);
	}

	let chatId = opts.chatId;
	const isNewChat = !chatId;
	let newMessageId: string;

	if (!chatId) {
		const imageParts = await saveAndBuildImageParts(message.images);
		const [createdChat, createdMessage] = await createChat(userId, projectId, message, imageParts);
		chatId = createdChat.id;
		newMessageId = createdMessage.id;
	} else {
		const { messageId } = await insertOrSupersedeMessage({
			userId,
			chatId,
			message,
			messageToEditId,
		});
		newMessageId = messageId;
	}

	const [chat] = await chatQueries.loadChat(chatId);
	if (!chat) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
	}

	await mcpService.initializeMcpState(projectId);
	await skillService.initializeSkills(projectId);

	const agent = await agentService.create({ ...chat, userId, projectId }, model);

	const stream = agent.stream(chat.messages, {
		mentions,
		timezone: opts.timezone,
		events: {
			newChat: isNewChat
				? {
						id: chatId,
						title: chat.title,
						isStarred: chat.isStarred,
						createdAt: chat.createdAt,
						updatedAt: chat.updatedAt,
					}
				: undefined,
			newUserMessage: { newId: newMessageId },
		},
	});

	return {
		chatId,
		isNewChat,
		modelId: agent.getModelId(),
		stream,
	};
};

async function saveAndBuildImageParts(images: ImageUploadData[] | undefined): Promise<UIMessagePart[]> {
	if (!images?.length) {
		return [];
	}

	const savedImages = await imageQueries.saveImages(images);
	return savedImages.map(({ id, mediaType }) => ({
		type: 'file' as const,
		mediaType,
		url: buildImageUrl(id),
	}));
}

const createChat = async (
	userId: string,
	projectId: string,
	message: AgentRequestUserMessage,
	imageParts: UIMessagePart[],
) => {
	const title = createChatTitle(message);
	return await chatQueries.createChat({ title, userId, projectId }, message, imageParts);
};

/** Insert a message into a chat or supersede an existing message when it is edited. */
const insertOrSupersedeMessage = async (opts: {
	userId: string;
	chatId: string;
	message: AgentRequestUserMessage;
	messageToEditId?: string;
}) => {
	const { userId, chatId, message, messageToEditId } = opts;
	const ownerId = await chatQueries.getChatOwnerId(chatId);
	if (!ownerId) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
	}
	if (ownerId !== userId) {
		throw new HandlerError('FORBIDDEN', 'You are not authorized to access this chat.');
	}

	const imageParts = await saveAndBuildImageParts(message.images);

	if (messageToEditId) {
		await chatQueries.supersedeMessagesFrom(chatId, messageToEditId);
	}
	return chatQueries.upsertMessage({
		role: 'user',
		parts: [{ type: 'text', text: message.text }, ...imageParts],
		chatId,
		source: 'web',
	});
};
