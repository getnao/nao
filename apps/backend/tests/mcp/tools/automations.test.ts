import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../../../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	accessRole: 'owner' as 'owner' | 'editor' | 'viewer',
	assertProjectCloudBillingAccess: vi.fn(),
	assertUserGroupFeature: vi.fn(),
	createAutomation: vi.fn(),
	deleteAutomation: vi.fn(),
	getAutomationById: vi.fn(),
	updateAutomation: vi.fn(),
	upsertRecurringJob: vi.fn(),
}));

vi.mock('../../../src/env', () => ({ env: { BETA_AUTOMATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://nao.test' } }));
vi.mock('../../../src/db/db', () => ({ db: {} }));
vi.mock('../../../src/handlers/automation.handler', () => ({ AUTOMATION_JOB_NAME: 'automation.run' }));
vi.mock('../../../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/queries/automation.queries', () => ({
	automationJobUniqueKey: (id: string) => `automation:${id}`,
	createAutomation: mocks.createAutomation,
	deleteAutomation: mocks.deleteAutomation,
	getAutomation: vi.fn(async (_projectId: string, _userId: string, _id: string, minimumRole: string) => {
		const roles = ['viewer', 'editor', 'owner'];
		return roles.indexOf(mocks.accessRole) >= roles.indexOf(minimumRole)
			? { ...SAVED_AUTOMATION, accessRole: mocks.accessRole }
			: null;
	}),
	getAutomationById: mocks.getAutomationById,
	linkAutomationJob: vi.fn(),
	updateAutomation: mocks.updateAutomation,
}));
vi.mock('../../../src/queries/scheduled-job.queries', () => ({
	deleteJob: vi.fn(),
	upsertRecurringJob: mocks.upsertRecurringJob,
}));
vi.mock('../../../src/services/automation-title', () => ({ inferAutomationTitle: vi.fn(async () => 'Daily sales') }));
vi.mock('../../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../../../src/services/mcp', () => ({ mcpService: {} }));
vi.mock('../../../src/services/user-group-feature-access.service', () => ({
	assertUserGroupFeature: mocks.assertUserGroupFeature,
}));

import { registerAutomationTools } from '../../../src/mcp/tools/automations';
import { HandlerError } from '../../../src/utils/error';

const SAVED_AUTOMATION = {
	id: 'automation-1',
	title: 'Daily sales',
	prompt: 'Report yesterday’s sales.',
	cron: '0 9 * * *',
	enabled: true,
	scheduledJobId: 'job-1',
	scheduleDescription: 'Every day at 9am',
	modelProvider: null,
	modelId: null,
	llmConfigId: null,
	mcpEnabled: true,
	mcpServers: null,
	integrations: { slack: { enabled: true, channelId: '#sales' } },
	webhookEnabled: false,
	eventTriggers: {},
};

const connections: Array<{ client: Client; server: McpServer }> = [];

beforeEach(() => {
	mocks.accessRole = 'owner';
	mocks.createAutomation.mockResolvedValue({ id: 'automation-1' });
	mocks.updateAutomation.mockResolvedValue({ id: 'automation-1' });
	mocks.upsertRecurringJob.mockResolvedValue({ id: 'job-1' });
	mocks.getAutomationById.mockResolvedValue(SAVED_AUTOMATION);
});

afterEach(async () => {
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP create_automation', () => {
	it('saves the automation for the user and schedules it', async () => {
		const result = await (
			await connect('user')
		).callTool({
			name: 'create_automation',
			arguments: {
				prompt: 'Report yesterday’s sales.',
				schedule: { cron: '0 9 * * *', description: 'Every day at 9am' },
				slack: { enabled: true, channels: ['#sales'] },
			},
		});

		expect(result.isError).toBeFalsy();
		expect(mocks.createAutomation).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'project-1',
				userId: 'user-1',
				title: 'Daily sales',
				prompt: 'Report yesterday’s sales.',
				integrations: { slack: { enabled: true, channelId: '#sales' } },
			}),
		);
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({ cron: '0 9 * * *', status: 'pending' }),
		);
		expect(result.structuredContent).toMatchObject({
			automation_id: 'automation-1',
			url: 'https://nao.test/automations/automation-1',
		});
	});

	it.each<{ case: string; role: McpUserRole; arrange: () => void; args: Record<string, unknown>; error: string }>([
		{
			case: 'without the automation creation grant of their user group',
			role: 'user',
			arrange: () =>
				mocks.assertUserGroupFeature.mockRejectedValueOnce(
					new HandlerError('FORBIDDEN', 'Automation creation is not enabled for your user group.'),
				),
			args: { webhook_enabled: true },
			error: 'Automation creation is not enabled for your user group.',
		},
		{
			case: 'without billing access',
			role: 'admin',
			arrange: () =>
				mocks.assertProjectCloudBillingAccess.mockRejectedValueOnce(
					new HandlerError('FORBIDDEN', 'Cloud billing access is restricted'),
				),
			args: { webhook_enabled: true },
			error: 'Cloud billing access is restricted',
		},
		{
			case: 'on chat feedback when they are a member',
			role: 'user',
			arrange: () => {},
			args: { feedback_trigger: { enabled: true, sources: ['chat'] } },
			error: 'Only admins and context admins can run automations on chat feedback',
		},
		{
			case: 'without any trigger',
			role: 'admin',
			arrange: () => {},
			args: {},
			error: 'Add at least one trigger.',
		},
	])('refuses it $case, like the app does', async ({ role, arrange, args, error }) => {
		arrange();

		const result = await (
			await connect(role)
		).callTool({ name: 'create_automation', arguments: { prompt: 'Report sales.', ...args } });

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain(error);
		expect(mocks.createAutomation).not.toHaveBeenCalled();
	});
});

describe('MCP update_automation', () => {
	it('changes only the fields passed and keeps the others', async () => {
		mocks.accessRole = 'editor';

		const result = await (
			await connect('user')
		).callTool({ name: 'update_automation', arguments: { automation_id: 'automation-1', title: 'Sales digest' } });

		expect(result.isError).toBeFalsy();
		expect(mocks.updateAutomation).toHaveBeenCalledWith(
			'project-1',
			'automation-1',
			expect.objectContaining({
				title: 'Sales digest',
				prompt: SAVED_AUTOMATION.prompt,
				integrations: SAVED_AUTOMATION.integrations,
			}),
		);
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({ cron: '0 9 * * *', status: 'pending' }),
		);
	});

	it('refuses users the automation is only shared with as viewers', async () => {
		mocks.accessRole = 'viewer';

		const result = await (
			await connect('user')
		).callTool({ name: 'update_automation', arguments: { automation_id: 'automation-1', title: 'Sales digest' } });

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('that you can edit');
		expect(mocks.updateAutomation).not.toHaveBeenCalled();
	});
});

describe('MCP delete_automation', () => {
	it('lets only the owner delete an automation', async () => {
		mocks.accessRole = 'editor';
		const client = await connect('user');

		const refused = await client.callTool({
			name: 'delete_automation',
			arguments: { automation_id: 'automation-1' },
		});
		expect(refused.isError).toBe(true);
		expect(mocks.deleteAutomation).not.toHaveBeenCalled();

		mocks.accessRole = 'owner';
		const deleted = await client.callTool({
			name: 'delete_automation',
			arguments: { automation_id: 'automation-1' },
		});
		expect(deleted.structuredContent).toEqual({ automation_id: 'automation-1', deleted: true });
		expect(mocks.deleteAutomation).toHaveBeenCalledWith('project-1', 'user-1', 'automation-1');
	});
});

async function connect(role: McpUserRole): Promise<Client> {
	const server = new McpServer({ name: 'test', version: '0.0.0' });
	registerAutomationTools(server, {
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
