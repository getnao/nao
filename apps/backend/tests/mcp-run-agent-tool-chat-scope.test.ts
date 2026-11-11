import type { Tool } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chats = vi.hoisted(() => new Map<string, { ownerId: string; projectId: string }>());
const contexts = vi.hoisted(() => ({
	buildToolContext: vi.fn(async (opts: { chatId: string }) => ({ chatId: opts.chatId })),
	buildMcpToolContext: vi.fn(async () => ({ chatId: null })),
}));

vi.mock('../src/db/db', () => ({ db: {} }));

vi.mock('../src/services/agent', () => contexts);

vi.mock('../src/queries/chat.queries', () => ({
	getChatOwnerId: async (chatId: string) => chats.get(chatId)?.ownerId ?? null,
	getChatProjectId: async (chatId: string) => chats.get(chatId)?.projectId ?? null,
}));

import type { McpContext } from '../src/mcp/logging';
import { runAgentTool } from '../src/mcp/tools/run-agent-tool';

const ctx = { userId: 'caller', projectId: 'project-a' } as McpContext;

describe('runAgentTool chat scope', () => {
	beforeEach(() => {
		chats.clear();
		chats.set('own-chat', { ownerId: 'caller', projectId: 'project-a' });
		chats.set('someone-elses-chat', { ownerId: 'victim', projectId: 'project-a' });
		chats.set('other-project-chat', { ownerId: 'caller', projectId: 'project-b' });
		vi.clearAllMocks();
	});

	it("runs inside the caller's own chat in the project", async () => {
		expect(await runInChat('own-chat')).toEqual({ chatId: 'own-chat' });
		expect(contexts.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-a',
			userId: 'caller',
			chatId: 'own-chat',
		});
	});

	it.each([
		['owned by another user', 'someone-elses-chat'],
		['of another project', 'other-project-chat'],
		['that does not exist', 'unknown-chat'],
	])('runs outside any chat when given a chat %s', async (_case, chatId) => {
		expect(await runInChat(chatId)).toEqual({ chatId: null });
		expect(contexts.buildToolContext).not.toHaveBeenCalled();
	});

	it('runs outside any chat when no chat is given', async () => {
		expect(await runInChat(null)).toEqual({ chatId: null });
		expect(contexts.buildToolContext).not.toHaveBeenCalled();
	});
});

async function runInChat(chatId: string | null): Promise<unknown> {
	return runAgentTool(contextEchoTool(), {}, ctx, chatId);
}

function contextEchoTool(): Tool<object, unknown> {
	return {
		inputSchema: {},
		execute: async (_input, options) => options.experimental_context,
	} as unknown as Tool<object, unknown>;
}
