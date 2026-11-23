import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../../../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	hasUserGroupFeature: vi.fn(),
	createPersonalSkill: vi.fn(),
	listPersonalSkills: vi.fn(),
}));

vi.mock('../../../src/db/db', () => ({ db: {} }));
vi.mock('../../../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/user-group-feature-access.service', () => ({
	hasUserGroupFeature: mocks.hasUserGroupFeature,
}));
vi.mock('../../../src/services/user-skill.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../src/services/user-skill.service')>()),
	createPersonalSkill: mocks.createPersonalSkill,
	listPersonalSkills: mocks.listPersonalSkills,
}));

import { registerPersonalSkillTools } from '../../../src/mcp/tools/personal-skills';

const connections: Array<{ client: Client; server: McpServer }> = [];
const SKILL = { name: 'weekly-orders', description: 'My Monday numbers.', shareStatus: 'private' };

beforeEach(() => {
	mocks.hasUserGroupFeature.mockResolvedValue(false);
	mocks.createPersonalSkill.mockResolvedValue({ ...SKILL, body: 'Completed orders only.' });
	mocks.listPersonalSkills.mockResolvedValue([{ ...SKILL, body: 'Completed orders only.' }]);
});

afterEach(async () => {
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP personal skill tools registration', () => {
	it.each<McpUserRole>(['admin', 'context_admin'])('exposes them to %s', async (role) => {
		expect(await toolNames(await connect(role))).toEqual(['list_personal_skills', 'create_personal_skill']);
	});

	it('exposes them to members only when one of their groups grants personal skills', async () => {
		expect(await toolNames(await connect('user'))).toEqual([]);

		mocks.hasUserGroupFeature.mockResolvedValue(true);
		expect(await toolNames(await connect('user'))).toEqual(['list_personal_skills', 'create_personal_skill']);
		expect(mocks.hasUserGroupFeature).toHaveBeenCalledWith('project-1', 'user-1', 'personalSkills');
	});
});

describe('MCP create_personal_skill', () => {
	it('creates the skill for the user with the instructions as its body', async () => {
		const client = await connect('admin');

		const result = await client.callTool({
			name: 'create_personal_skill',
			arguments: { name: 'weekly-orders', description: 'My Monday numbers.', instructions: ' Completed only. ' },
		});

		expect(result.isError).toBeFalsy();
		expect(mocks.createPersonalSkill).toHaveBeenCalledWith('project-1', 'user-1', {
			name: 'weekly-orders',
			description: 'My Monday numbers.',
			body: 'Completed only.',
		});
		expect(result.structuredContent).toEqual(SKILL);
	});

	it('tells the client when the name is already taken', async () => {
		mocks.createPersonalSkill.mockRejectedValue(
			new TRPCError({ code: 'CONFLICT', message: "The project already has a skill called 'weekly-orders'." }),
		);
		const client = await connect('admin');

		const result = await client.callTool({
			name: 'create_personal_skill',
			arguments: { name: 'weekly-orders', description: '', instructions: 'Steps.' },
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("already has a skill called 'weekly-orders'");
	});

	it('lists the user’s personal skills without their instructions', async () => {
		const result = await (await connect('admin')).callTool({ name: 'list_personal_skills', arguments: {} });

		expect(mocks.listPersonalSkills).toHaveBeenCalledWith('project-1', 'user-1');
		expect(result.structuredContent).toEqual({ skills: [SKILL] });
	});
});

async function connect(role: McpUserRole): Promise<Client> {
	const server = new McpServer({ name: 'test', version: '0.0.0' });
	await registerPersonalSkillTools(server, {
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
	try {
		const { tools } = await client.listTools();
		return tools.map((tool) => tool.name);
	} catch {
		return [];
	}
}
