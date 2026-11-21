import { isToolUIPart } from 'ai';

import type { DBProject } from '../db/abstractSchema';
import { persistUserMessage } from '../handlers/agent';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import type { UIMessage, UIMessagePart } from '../types/chat';
import type { LocalAgentTurn, LocalAgentTurnCompletion, LocalAgentTurnRequest } from '../types/local-agent';
import { settleToolParts } from '../utils/ai';
import { HandlerError } from '../utils/error';
import { generateLocalAgentToken } from '../utils/local-agent-token';
import { renderLocalAgentHistory } from '../utils/local-agent-transcript';
import { assertUserIsActive } from './account-status.service';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import { findLocalAgentSession, openLocalAgentSession, type RecordedToolCall } from './local-agent-session';
import { mcpService } from './mcp';
import { skillService } from './skill';

export const LOCAL_AGENT_MCP_PATH = '/api/local-agent/mcp';

/** Saves the user's message and hands the desktop app what its local Claude needs to answer it. */
export async function startLocalAgentTurn(opts: {
	userId: string;
	currentProject: DBProject | null;
	request: LocalAgentTurnRequest;
}): Promise<LocalAgentTurn> {
	const { userId, request } = opts;
	const projectId = await resolveProjectId(request.chatId, opts.currentProject);
	await assertCanRunLocalAgent(userId, projectId, request.chatId);

	const { chat, chatId, isNewChat, newMessageId } = await persistUserMessage({
		userId,
		projectId,
		message: { text: request.message.text },
		chatId: request.chatId,
		messageToEditId: request.messageToEditId,
		source: 'web',
	});
	await Promise.all([mcpService.initializeMcpState(projectId), skillService.initializeSkills(projectId)]);
	const session = await openLocalAgentSession({ ...chat, userId, projectId }, request.timezone);

	return {
		chatId,
		isNewChat,
		...(isNewChat && {
			newChat: {
				id: chatId,
				projectId,
				title: chat.title,
				isStarred: chat.isStarred,
				createdAt: chat.createdAt,
				updatedAt: chat.updatedAt,
			},
		}),
		userMessageId: newMessageId,
		systemPrompt: session.systemPrompt,
		history: renderLocalAgentHistory(chat.messages.filter((message) => message.id !== newMessageId)),
		mcp: { url: LOCAL_AGENT_MCP_PATH, token: generateLocalAgentToken({ userId, projectId, chatId }) },
	};
}

/**
 * Saves the answer of the local Claude. Tool results this server produced replace the ones the
 * desktop app reports, so a chat only keeps query results nao actually returned.
 */
export async function completeLocalAgentTurn(userId: string, completion: LocalAgentTurnCompletion): Promise<void> {
	const ownerId = await chatQueries.getChatOwnerId(completion.chatId);
	if (!ownerId) {
		throw new HandlerError('NOT_FOUND', `Chat with id ${completion.chatId} not found.`);
	}
	if (ownerId !== userId) {
		throw new HandlerError('FORBIDDEN', 'You are not authorized to access this chat.');
	}

	const recordedToolCalls = findLocalAgentSession(completion.chatId)?.recordedToolCalls;
	const parts = (completion.message.parts as UIMessagePart[]).map((part) =>
		withRecordedToolResult(part, recordedToolCalls),
	);
	const message: UIMessage = { id: completion.message.id, role: 'assistant', parts };
	const [settledMessage] = await settleToolParts([message]);
	await chatQueries.upsertMessage({
		...settledMessage,
		chatId: completion.chatId,
		senderUserId: userId,
		source: 'web',
		stopReason: completion.stopReason,
		error: completion.errorMessage,
		llmModelId: completion.modelId,
	});
}

async function resolveProjectId(chatId: string | undefined, currentProject: DBProject | null): Promise<string> {
	if (chatId) {
		const chatProjectId = await chatQueries.getChatProjectId(chatId);
		if (!chatProjectId) {
			throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
		}
		return chatProjectId;
	}
	if (!currentProject) {
		throw new HandlerError('BAD_REQUEST', 'Select a project to chat with your Claude Code.');
	}
	return currentProject.id;
}

async function assertCanRunLocalAgent(userId: string, projectId: string, chatId: string | undefined): Promise<void> {
	await assertUserIsActive(userId);
	const userRole = await projectQueries.getUserRoleInProject(projectId, userId);
	if (!userRole || userRole === 'viewer') {
		throw new HandlerError('FORBIDDEN', 'Viewers cannot send messages');
	}
	if (chatId && (await chatQueries.isOnboardingChat(chatId))) {
		throw new HandlerError('FORBIDDEN', 'Onboarding conversations must be continued through onboarding');
	}
	await assertProjectCloudBillingAccess(projectId);
}

function withRecordedToolResult(
	part: UIMessagePart,
	recordedToolCalls: Map<string, RecordedToolCall> | undefined,
): UIMessagePart {
	const recorded = isToolUIPart(part) ? recordedToolCalls?.get(part.toolCallId) : undefined;
	if (!recorded || !isToolUIPart(part)) {
		return part;
	}
	if (recorded.errorText !== undefined) {
		return {
			...part,
			input: recorded.input,
			state: 'output-error',
			errorText: recorded.errorText,
		} as UIMessagePart;
	}
	return { ...part, input: recorded.input, state: 'output-available', output: recorded.output } as UIMessagePart;
}
