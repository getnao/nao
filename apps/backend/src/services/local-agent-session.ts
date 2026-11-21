import type { Tool } from 'ai';

import { analyticsAgent } from '../agents/profiles/analytics';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import type { ToolContext } from '../types/tools';
import { type AgentChat, buildToolContext } from './agent';
import { buildAgentSystemPrompt } from './agent-system-prompt';
import { resolveLinkedStory } from './story-question';
import { resolveAgentUserGroupAccess } from './user-group-feature-access.service';

/** Tools that drive the server's own model, which a turn on the user's Claude does not use. */
const SERVER_MODEL_TOOLS = ['task', 'codemode'];
const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000;

export interface RecordedToolCall {
	toolName: string;
	input: unknown;
	output?: unknown;
	errorText?: string;
}

/** The nao tools of one chat, kept between the MCP requests of the user's local Claude. */
export interface LocalAgentSession {
	chat: AgentChat;
	tools: Record<string, Tool>;
	toolContext: ToolContext;
	systemPrompt: string;
	recordedToolCalls: Map<string, RecordedToolCall>;
	lastUsedAt: number;
}

const sessions = new Map<string, LocalAgentSession>();

export async function openLocalAgentSession(chat: AgentChat, timezone?: string): Promise<LocalAgentSession> {
	const session = await buildSession(chat, timezone);
	sessions.set(chat.id, session);
	return session;
}

/** The session of the chat, rebuilt when this server instance has not seen the chat or let it expire. */
export async function getLocalAgentSession(chat: AgentChat): Promise<LocalAgentSession> {
	evictIdleSessions();
	const existing = sessions.get(chat.id);
	if (existing && existing.chat.userId === chat.userId && existing.chat.projectId === chat.projectId) {
		existing.lastUsedAt = Date.now();
		return existing;
	}
	return openLocalAgentSession(chat);
}

export function findLocalAgentSession(chatId: string): LocalAgentSession | undefined {
	return sessions.get(chatId);
}

export function recordToolCall(session: LocalAgentSession, toolCallId: string, call: RecordedToolCall): void {
	session.recordedToolCalls.set(toolCallId, call);
}

async function buildSession(chat: AgentChat, timezone?: string): Promise<LocalAgentSession> {
	const [agentSettings, customBoundaries, chatRow] = await Promise.all([
		projectQueries.getAgentSettings(chat.projectId),
		projectQueries.getCustomBoundaries(chat.projectId),
		chatQueries.getChat(chat.id).then(([row]) => row),
	]);
	const agentChat: AgentChat = chatRow ? { ...chatRow, userId: chat.userId, projectId: chat.projectId } : chat;
	const toolContext = await buildToolContext({
		projectId: chat.projectId,
		userId: chat.userId,
		chatId: chat.id,
		querySource: analyticsAgent.source,
		agentSettings,
		supportsCustomCharts: analyticsAgent.supportsCustomCharts,
	});
	toolContext.linkedStory = await resolveLinkedStory(agentChat);
	const agentTools = await analyticsAgent.tools({
		chat: agentChat,
		agentSettings,
		toolContext,
		webTools: null,
		customBoundaries,
	});
	const tools = keepLocallyRunnableTools(agentTools as Record<string, Tool>);
	const systemPrompt = await buildAgentSystemPrompt({
		chat: agentChat,
		profile: analyticsAgent,
		toolContext,
		toolNames: Object.keys(tools),
		userGroupAccess: resolveAgentUserGroupAccess(toolContext.userGroupFeatures, tools),
		timezone,
	});
	return { chat: agentChat, tools, toolContext, systemPrompt, recordedToolCalls: new Map(), lastUsedAt: Date.now() };
}

function keepLocallyRunnableTools(tools: Record<string, Tool>): Record<string, Tool> {
	return Object.fromEntries(
		Object.entries(tools).filter(([name, tool]) => !SERVER_MODEL_TOOLS.includes(name) && tool.execute),
	);
}

function evictIdleSessions(): void {
	const oldestAllowed = Date.now() - SESSION_IDLE_TTL_MS;
	for (const [chatId, session] of sessions) {
		if (session.lastUsedAt < oldestAllowed) {
			sessions.delete(chatId);
		}
	}
}
