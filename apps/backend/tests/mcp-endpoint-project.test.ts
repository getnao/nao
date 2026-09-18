import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	userId: 'user-1' as string | null,
	projects: [] as Array<{ id: string; name: string }>,
	roles: {} as Record<string, string | null>,
	createdForProjects: [] as string[],
}));

vi.mock('../src/db/db', () => ({ db: {} }));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
	serializeError: (error: unknown) => String(error),
}));

vi.mock('../src/mcp/auth', () => ({
	resolveUserId: async () => testState.userId,
}));

vi.mock('../src/queries/project.queries', () => ({
	listUserProjects: async () => testState.projects,
	getUserRoleInProject: async (projectId: string) => testState.roles[projectId] ?? null,
}));

vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	getMcpEndpointSettings: async () => ({
		enabled: true,
		subAgentModeEnabled: true,
		contextLayerModeEnabled: true,
	}),
}));

vi.mock('../src/mcp/server', () => ({
	createMcpServer: async (_userId: string, projectId: string) => {
		testState.createdForProjects.push(projectId);
		return new McpServer({ name: 'test', version: '0.0.0' });
	},
}));

vi.mock('../src/mcp/embed/mcp-apps-bundle', () => ({
	MCP_APPS_SCRIPT_PATH: '/mcp-apps.js',
	getMcpAppsBundle: () => '',
}));

import { MCP_SERVER_URL } from '../src/env';
import { resolveMcpProjectId } from '../src/mcp/project';
import { mcpServerRoutes } from '../src/mcp/routes';

const MCP_BASE_URL = MCP_SERVER_URL;

const INITIALIZE_REQUEST = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'test-client', version: '0.0.0' },
	},
};

async function createApp() {
	const app = fastify();
	await app.register(mcpServerRoutes as never, { prefix: '/mcp' });
	await app.ready();
	return app;
}

async function postInitialize(app: Awaited<ReturnType<typeof createApp>>, url: string) {
	return app.inject({
		method: 'POST',
		url,
		headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
		payload: INITIALIZE_REQUEST,
	});
}

describe('resolveMcpProjectId', () => {
	beforeEach(() => {
		testState.projects = [];
	});

	it('uses the project id from the URL when given', async () => {
		testState.projects = [
			{ id: 'project-a', name: 'A' },
			{ id: 'project-b', name: 'B' },
		];

		await expect(resolveMcpProjectId('user-1', 'project-b', MCP_BASE_URL)).resolves.toEqual({
			projectId: 'project-b',
		});
	});

	it('falls back to the only project of the user', async () => {
		testState.projects = [{ id: 'project-a', name: 'A' }];

		await expect(resolveMcpProjectId('user-1', undefined, MCP_BASE_URL)).resolves.toEqual({
			projectId: 'project-a',
		});
	});

	it('lists the project-specific endpoints when the user belongs to several projects', async () => {
		testState.projects = [
			{ id: 'project-a', name: 'Sales' },
			{ id: 'project-b', name: 'Marketing' },
		];

		const resolution = await resolveMcpProjectId('user-1', undefined, MCP_BASE_URL);

		expect(resolution).toHaveProperty('error');
		const { error } = resolution as { error: string };
		expect(error).toContain(`Sales: ${MCP_BASE_URL}/project-a`);
		expect(error).toContain(`Marketing: ${MCP_BASE_URL}/project-b`);
	});

	it('reports when the user has no project', async () => {
		await expect(resolveMcpProjectId('user-1', undefined, MCP_BASE_URL)).resolves.toEqual({
			error: expect.stringContaining('No projects found'),
		});
	});
});

describe('MCP endpoint project scoping', () => {
	let app: Awaited<ReturnType<typeof createApp>>;

	beforeEach(async () => {
		testState.userId = 'user-1';
		testState.projects = [
			{ id: 'project-a', name: 'Sales' },
			{ id: 'project-b', name: 'Marketing' },
		];
		testState.roles = { 'project-a': 'admin', 'project-b': 'user' };
		testState.createdForProjects = [];
		app = await createApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('serves the project named in the URL', async () => {
		const response = await postInitialize(app, '/mcp/project-b');

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain('"serverInfo"');
		expect(testState.createdForProjects).toEqual(['project-b']);
	});

	it('rejects the bare endpoint for users in several projects and points to the scoped URLs', async () => {
		const response = await postInitialize(app, '/mcp');

		expect(response.statusCode).toBe(400);
		expect(response.json().error).toContain(`${MCP_BASE_URL}/project-a`);
		expect(response.json().error).toContain(`${MCP_BASE_URL}/project-b`);
		expect(testState.createdForProjects).toEqual([]);
	});

	it('keeps the bare endpoint working for single-project users', async () => {
		testState.projects = [{ id: 'project-a', name: 'Sales' }];

		const response = await postInitialize(app, '/mcp');

		expect(response.statusCode).toBe(200);
		expect(testState.createdForProjects).toEqual(['project-a']);
	});

	it('forbids projects the user is not a member of', async () => {
		const response = await postInitialize(app, '/mcp/project-of-someone-else');

		expect(response.statusCode).toBe(403);
		expect(testState.createdForProjects).toEqual([]);
	});

	it('forbids viewers of the requested project', async () => {
		testState.roles['project-b'] = 'viewer';

		const response = await postInitialize(app, '/mcp/project-b');

		expect(response.statusCode).toBe(403);
	});

	it('challenges unauthenticated requests on the scoped URL', async () => {
		testState.userId = null;

		const response = await postInitialize(app, '/mcp/project-a');

		expect(response.statusCode).toBe(401);
		expect(response.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource');
	});

	it('answers 405 to GET on the scoped URL like on the bare one', async () => {
		const response = await app.inject({ method: 'GET', url: '/mcp/project-a' });

		expect(response.statusCode).toBe(405);
	});
});
