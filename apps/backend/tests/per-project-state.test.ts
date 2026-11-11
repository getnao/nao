import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const projectPaths = vi.hoisted(() => new Map<string, string>());

vi.mock('mcporter', () => ({
	createRuntime: async () => ({
		registerDefinition: () => undefined,
		listTools: async () => [],
		callTool: async () => ({}),
	}),
}));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloud: false,
}));
vi.mock('../src/services/warehouse-credentials', () => ({
	getProjectWarehouseEnvVars: async () => ({}),
}));
vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: async (projectId: string) => ({ path: projectPaths.get(projectId) }),
	getDisabledMcpServers: async () => [],
	getDisabledMcpTools: async () => [],
	getEnvVars: async () => ({}),
}));
vi.mock('../src/queries/mcp-oauth.queries', () => ({
	claimMcpDiscoveryUser: async () => false,
	deleteMcpUserToken: async () => undefined,
	getMcpOAuthClient: async () => null,
	hasMcpUserToken: async () => false,
}));

import type { TelegramConfig } from '../src/queries/project-telegram-config.queries';
import type { WhatsappConfig } from '../src/queries/project-whatsapp-config.queries';
import { McpService, mcpService } from '../src/services/mcp';
import { TelegramProjectBot, telegramService } from '../src/services/telegram';
import { WhatsappProjectBot, whatsappService } from '../src/services/whatsapp';
import { PerProjectInstances } from '../src/utils/per-project-instances';

const temporaryRoots: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	projectPaths.clear();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PerProjectInstances', () => {
	it('keeps one instance per project', () => {
		const instances = new PerProjectInstances({ create: () => ({}) });

		expect(instances.get('project-a')).toBe(instances.get('project-a'));
		expect(instances.get('project-a')).not.toBe(instances.get('project-b'));
	});

	it('evicts the least recently used project past the limit', () => {
		const evicted: string[] = [];
		let created = 0;
		const instances = new PerProjectInstances({
			create: () => `instance-${++created}`,
			maxInstances: 2,
			onEvict: (instance) => evicted.push(instance),
		});

		instances.get('project-a');
		instances.get('project-b');
		instances.get('project-a');
		instances.get('project-c');

		expect(evicted).toEqual(['instance-2']);
		expect(instances.peek('project-b')).toBeUndefined();
		expect(instances.peek('project-a')).toBe('instance-1');
	});

	it('does not create an instance on peek', () => {
		const create = vi.fn(() => ({}));
		const instances = new PerProjectInstances({ create });

		expect(instances.peek('project-a')).toBeUndefined();
		expect(create).not.toHaveBeenCalled();
	});
});

describe('mcpService across projects', () => {
	it('answers each project with its own servers when their requests interleave', async () => {
		await createProject('mcp-project-a', ['crm-a']);
		await createProject('mcp-project-b', ['crm-b']);

		const [serversOfA, serversOfB] = await Promise.all([
			mcpService.getEnabledServers('mcp-project-a'),
			mcpService.getEnabledServers('mcp-project-b'),
		]);

		expect(serversOfA).toEqual(['crm-a']);
		expect(serversOfB).toEqual(['crm-b']);
		expect(mcpService.getConfiguredServerNames('mcp-project-a')).toEqual(['crm-a']);
		expect(mcpService.getConfiguredServerNames('mcp-project-b')).toEqual(['crm-b']);
	});

	it('lists no servers for a project whose MCP state was never initialized', () => {
		expect(mcpService.getConfiguredServerNames('mcp-project-unknown')).toEqual([]);
	});

	it('stops watching the config of a disposed project', async () => {
		await createProject('mcp-project-disposed', ['crm']);
		const service = new McpService();
		await service.initializeMcpState('mcp-project-disposed');

		service.dispose();

		expect((service as unknown as { _fileWatcher: unknown })._fileWatcher).toBeNull();
	});
});

describe('messaging bots across projects', () => {
	it('gives each project its own Telegram bot', () => {
		const bots = recordBots(TelegramProjectBot.prototype);

		telegramService.getWebhooks(telegramConfig('telegram-project-a'));
		telegramService.getWebhooks(telegramConfig('telegram-project-b'));
		telegramService.getWebhooks(telegramConfig('telegram-project-a'));

		expect(bots[0]).not.toBe(bots[1]);
		expect(bots[2]).toBe(bots[0]);
	});

	it('gives each project its own WhatsApp bot', () => {
		const bots = recordBots(WhatsappProjectBot.prototype);

		whatsappService.getWebhooks(whatsappConfig('whatsapp-project-a'));
		whatsappService.getWebhooks(whatsappConfig('whatsapp-project-b'));
		whatsappService.getWebhooks(whatsappConfig('whatsapp-project-a'));

		expect(bots[0]).not.toBe(bots[1]);
		expect(bots[2]).toBe(bots[0]);
	});
});

async function createProject(projectId: string, servers: string[]): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'nao-per-project-mcp-'));
	temporaryRoots.push(root);
	const mcpsDir = join(root, 'agent', 'mcps');
	await mkdir(mcpsDir, { recursive: true });
	const mcpServers = Object.fromEntries(servers.map((name) => [name, { command: 'node', args: ['--version'] }]));
	await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers }), 'utf8');
	projectPaths.set(projectId, root);
}

function recordBots(prototype: { getWebhooks: (config: never) => unknown }): unknown[] {
	const bots: unknown[] = [];
	vi.spyOn(prototype, 'getWebhooks').mockImplementation(function (this: unknown) {
		bots.push(this);
		return undefined;
	});
	return bots;
}

function telegramConfig(projectId: string): TelegramConfig {
	return { projectId, botToken: `token-${projectId}`, redirectUrl: 'https://nao.example/' } as TelegramConfig;
}

function whatsappConfig(projectId: string): WhatsappConfig {
	return { projectId, accessToken: `token-${projectId}`, redirectUrl: 'https://nao.example/' } as WhatsappConfig;
}
