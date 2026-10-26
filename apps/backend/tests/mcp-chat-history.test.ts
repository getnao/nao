import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	listProjectChats: vi.fn(),
	getChatProjectId: vi.fn(),
	getChat: vi.fn(),
	getUserName: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/queries/project.queries', () => ({ listProjectChats: mocks.listProjectChats }));
vi.mock('../src/queries/chat.queries', () => ({
	getChatProjectId: mocks.getChatProjectId,
	getChat: mocks.getChat,
}));
vi.mock('../src/queries/user.queries', () => ({ getUserName: mocks.getUserName }));

import { registerContextAdminTools } from '../src/mcp/tools/context-admin-tools';

const BASELINE_TOOL = 'baseline';

const connections: Array<{ client: Client; server: McpServer }> = [];

afterEach(async () => {
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP context admin tools', () => {
	it.each<McpUserRole>(['admin', 'context_admin'])('exposes the chat history tools to %s', async (role) => {
		const client = await connect(role);

		expect(await toolNames(client)).toEqual(expect.arrayContaining(['search_chats', 'get_chat']));
	});

	it('hides the chat history tools from regular users', async () => {
		const client = await connect('user');

		expect(await toolNames(client)).toEqual([BASELINE_TOOL]);
	});
});

describe('MCP search_chats', () => {
	it('translates the search criteria into a project chat listing', async () => {
		mocks.listProjectChats.mockResolvedValue({ chats: [], total: 0, facets: {} });
		const client = await connect('admin');

		await client.callTool({
			name: 'search_chats',
			arguments: {
				search: 'revenue',
				author: 'alice',
				sources: ['slack'],
				has_tool_errors: true,
				feedback: ['downvotes'],
				min_messages: 4,
				updated_after: '2026-10-01',
				sort_by: 'numberOfMessages',
				limit: 10,
				page: 2,
			},
		});

		expect(mocks.listProjectChats).toHaveBeenCalledWith('project-1', {
			page: 2,
			pageSize: 10,
			search: 'revenue',
			author: 'alice',
			messageCount: { min: 4, max: undefined },
			filters: [
				{ id: 'source', values: ['slack'] },
				{ id: 'toolState', values: ['toolsWithErrors'] },
				{ id: 'feedback', values: ['downvotes'] },
			],
			updatedAtFilter: { mode: 'range', start: '2026-10-01', end: '9999-12-31' },
			sorting: [{ id: 'numberOfMessages', desc: true }],
		});
	});

	it('maps chats without tool errors to both error-free tool states', async () => {
		mocks.listProjectChats.mockResolvedValue({ chats: [], total: 0, facets: {} });
		const client = await connect('admin');

		await client.callTool({ name: 'search_chats', arguments: { has_tool_errors: false } });

		expect(mocks.listProjectChats.mock.calls[0][1].filters).toEqual([
			{ id: 'toolState', values: ['noToolsUsed', 'toolsNoErrors'] },
		]);
	});

	it('returns chat summaries with a replay link and pagination', async () => {
		mocks.listProjectChats.mockResolvedValue({
			chats: [projectChatListItem({ id: 'chat-1', toolErrorCount: 2, toolAvailableCount: 3 })],
			total: 21,
			facets: {},
		});
		const client = await connect('admin');

		const result = await client.callTool({ name: 'search_chats', arguments: {} });

		expect(result.structuredContent).toMatchObject({
			total: 21,
			hasMore: true,
			chats: [
				{
					id: 'chat-1',
					author: { id: 'user-2', name: 'Alice', role: 'user' },
					toolCallCount: 5,
					toolErrorCount: 2,
					updatedAt: '2026-10-20T10:00:00.000Z',
					replayUrl: expect.stringMatching(/\/settings\/usage\/replay\/chat-1$/),
				},
			],
		});
	});
});

describe('MCP get_chat', () => {
	it('returns the transcript with tool errors and feedback', async () => {
		mocks.getChatProjectId.mockResolvedValue('project-1');
		mocks.getChat.mockResolvedValue([uiChat(), 'user-2']);
		mocks.getUserName.mockResolvedValue('Alice');
		const client = await connect('context_admin');

		const result = await client.callTool({ name: 'get_chat', arguments: { chat_id: 'chat-1' } });

		expect(mocks.getChat).toHaveBeenCalledWith('chat-1', { includeFeedback: true });
		expect(result.structuredContent).toMatchObject({
			id: 'chat-1',
			author: { id: 'user-2', name: 'Alice' },
			messages: [
				{ id: 'message-1', role: 'user', text: 'What is our revenue?', toolCalls: [], feedback: null },
				{
					id: 'message-2',
					role: 'assistant',
					text: 'I could not query the table.',
					toolCalls: [
						{
							toolName: 'execute_sql',
							state: 'output-error',
							input: '{"sql_query":"select * from orders"}',
							error: 'Table orders does not exist',
						},
					],
					feedback: { vote: 'down', explanation: 'Wrong table' },
				},
			],
		});
	});

	it('omits tool outputs unless asked for them', async () => {
		mocks.getChatProjectId.mockResolvedValue('project-1');
		mocks.getChat.mockResolvedValue([uiChat({ withSuccessfulTool: true }), 'user-2']);
		mocks.getUserName.mockResolvedValue('Alice');
		const client = await connect('admin');

		const withoutOutputs = await client.callTool({ name: 'get_chat', arguments: { chat_id: 'chat-1' } });
		const withOutputs = await client.callTool({
			name: 'get_chat',
			arguments: { chat_id: 'chat-1', include_tool_outputs: true },
		});

		const successfulCall = {
			toolName: 'execute_sql',
			state: 'output-available',
			input: '{"sql_query":"select * from sales"}',
		};
		expect(lastToolCall(withoutOutputs)).toEqual(successfulCall);
		expect(lastToolCall(withOutputs)).toEqual({ ...successfulCall, output: '{"row_count":1}' });
	});

	it('refuses chats from another project', async () => {
		mocks.getChatProjectId.mockResolvedValue('project-2');
		const client = await connect('admin');

		const result = await client.callTool({ name: 'get_chat', arguments: { chat_id: 'chat-1' } });

		expect(result.isError).toBe(true);
		expect(mocks.getChat).not.toHaveBeenCalled();
	});
});

async function connect(role: McpUserRole): Promise<Client> {
	const server = new McpServer({ name: 'test', version: '0.0.0' });
	server.registerTool(
		BASELINE_TOOL,
		{ description: 'Always registered, like the tools of the other modes.' },
		() => ({
			content: [],
		}),
	);
	registerContextAdminTools(server, {
		userId: 'user-1',
		projectId: 'project-1',
		role,
		settings: { enabled: true, subAgentModeEnabled: true, contextLayerModeEnabled: true },
		chartDataMode: false,
		storyCreationEnabled: true,
		customStoryCreationEnabled: false,
	});
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	connections.push({ client, server });
	return client;
}

async function toolNames(client: Client): Promise<string[]> {
	const { tools } = await client.listTools();
	return tools.map((tool) => tool.name);
}

function lastToolCall(result: Awaited<ReturnType<Client['callTool']>>): unknown {
	const messages = (result.structuredContent as { messages: Array<{ toolCalls: unknown[] }> }).messages;
	return messages.at(-1)?.toolCalls.at(-1);
}

function projectChatListItem(overrides: Record<string, unknown>) {
	return {
		id: 'chat',
		updatedAt: Date.parse('2026-10-20T10:00:00.000Z'),
		userId: 'user-2',
		userName: 'Alice',
		userRole: 'user',
		title: 'Revenue',
		source: 'slack',
		numberOfMessages: 4,
		totalTokens: 1200,
		cacheReadTokens: 0,
		totalCost: 0.02,
		feedbackText: '',
		downvotes: 0,
		upvotes: 1,
		toolErrorCount: 0,
		toolAvailableCount: 0,
		...overrides,
	};
}

function uiChat(options: { withSuccessfulTool?: boolean } = {}) {
	const successfulTool = {
		type: 'tool-execute_sql',
		toolCallId: 'call-2',
		state: 'output-available',
		input: { sql_query: 'select * from sales' },
		output: { row_count: 1 },
	};
	return {
		id: 'chat-1',
		projectId: 'project-1',
		title: 'Revenue',
		isStarred: false,
		createdAt: Date.parse('2026-10-20T09:00:00.000Z'),
		updatedAt: Date.parse('2026-10-20T10:00:00.000Z'),
		messages: [
			{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'What is our revenue?' }] },
			{
				id: 'message-2',
				role: 'assistant',
				feedback: { messageId: 'message-2', vote: 'down', explanation: 'Wrong table' },
				parts: [
					{
						type: 'tool-execute_sql',
						toolCallId: 'call-1',
						state: 'output-error',
						input: { sql_query: 'select * from orders' },
						errorText: 'Table orders does not exist',
					},
					...(options.withSuccessfulTool ? [successfulTool] : []),
					{ type: 'text', text: 'I could not query the table.' },
				],
			},
		],
	};
}
