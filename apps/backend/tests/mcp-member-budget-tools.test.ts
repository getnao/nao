import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	getMemberBudgetOverview: vi.fn(),
	isMemberBudgetLicensed: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/utils/member-budget', () => ({ isMemberBudgetLicensed: mocks.isMemberBudgetLicensed }));
vi.mock('../src/services/member-budget.service', () => ({
	getMemberBudgetOverview: mocks.getMemberBudgetOverview,
}));

import { registerMemberBudgetTools } from '../src/mcp/tools/member-budget';

const TOOL_NAME = 'export_member_budgets';

const BASELINE_TOOL = 'baseline';

const connections: Array<{ client: Client; server: McpServer }> = [];

beforeEach(() => {
	mocks.isMemberBudgetLicensed.mockResolvedValue(true);
	mocks.getMemberBudgetOverview.mockResolvedValue({
		period: 'month',
		defaultLimitUsd: 100,
		groups: [{ id: 'everyone', name: 'All Users', isDefault: true, limitUsd: 100 }],
		members: [
			{ id: 'ada', name: 'Ada', email: 'ada@example.com', spendUsd: 40, personalLimitUsd: null, groupIds: [] },
		],
	});
});

afterEach(async () => {
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP member budget tools registration', () => {
	it('exposes export_member_budgets to admins with the enterprise license', async () => {
		expect(await toolNames(await connect('admin'))).toContain(TOOL_NAME);
	});

	it.each<McpUserRole>(['user', 'context_admin'])('hides export_member_budgets from %s', async (role) => {
		expect(await toolNames(await connect(role))).not.toContain(TOOL_NAME);
		expect(mocks.isMemberBudgetLicensed).not.toHaveBeenCalled();
	});

	it('hides export_member_budgets without the enterprise license', async () => {
		mocks.isMemberBudgetLicensed.mockResolvedValue(false);

		expect(await toolNames(await connect('admin'))).not.toContain(TOOL_NAME);
	});
});

describe('MCP export_member_budgets', () => {
	it('returns the member rows and the same report as CSV', async () => {
		const client = await connect('admin');

		const result = await client.callTool({ name: TOOL_NAME, arguments: {} });

		expect(result.isError).toBeFalsy();
		expect(mocks.getMemberBudgetOverview).toHaveBeenCalledWith('project-1');
		expect(result.structuredContent).toMatchObject({
			period: 'month',
			members: [
				{ name: 'Ada', limitUsd: 100, source: 'default', remainingUsd: 60, spendUsd: 40, status: 'under' },
			],
		});
		const { csv } = result.structuredContent as { csv: string };
		expect(csv.split('\n')).toHaveLength(2);
		expect(csv).toContain('Ada,ada@example.com,All Users,month,');
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
	await registerMemberBudgetTools(server, {
		userId: 'user-1',
		projectId: 'project-1',
		role,
		settings: { enabled: true, subAgentModeEnabled: false, contextLayerModeEnabled: false },
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
