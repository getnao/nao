import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	createOAuthClient: vi.fn(),
	deleteWhere: vi.fn(),
	role: 'admin' as string | null,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/db/db', () => {
	const selectChain = {
		from: () => selectChain,
		where: () => selectChain,
		orderBy: () => selectChain,
		execute: async () => testState.rows,
	};
	return {
		db: {
			select: () => selectChain,
			delete: () => ({
				where: (arg: unknown) => {
					testState.deleteWhere(arg);
					return { execute: async () => undefined };
				},
			}),
		},
	};
});

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id' })),
	getUserRoleInProject: vi.fn(async () => testState.role),
}));

vi.mock('../src/auth', () => ({
	getAuth: vi.fn(async () => ({ api: { createOAuthClient: testState.createOAuthClient } })),
	getSession: vi.fn(async () => null),
}));

import { mcpOAuthClientsRoutes } from '../src/trpc/mcp-oauth-clients.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ mcpOAuthClients: mcpOAuthClientsRoutes });

function caller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id' }, session: { token: 'sess-tok' } },
		selectedProjectId: 'project-id',
	} as never);
}

describe('mcpOAuthClients router', () => {
	beforeEach(() => {
		testState.rows = [];
		testState.role = 'admin';
		testState.createOAuthClient.mockReset();
		testState.deleteWhere.mockReset();
	});

	afterEach(() => vi.clearAllMocks());

	it('lists clients without exposing secrets', async () => {
		testState.rows = [
			{ clientId: 'c1', name: 'dust', redirectUris: ['https://x/cb'], isPublic: false, createdAt: new Date() },
		];
		const result = await caller().mcpOAuthClients.list();
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ clientId: 'c1', name: 'dust', isPublic: false });
		expect(JSON.stringify(result)).not.toContain('secret');
	});

	it('creates a confidential client and returns the secret once', async () => {
		testState.createOAuthClient.mockResolvedValue({ client_id: 'new-id', client_secret: 's3cr3t' });
		const result = await caller().mcpOAuthClients.create({
			name: 'dust.tt',
			redirectUris: ['https://eu.dust.tt/oauth/mcp_static/finalize'],
			confidential: true,
		});
		expect(result).toEqual({ clientId: 'new-id', clientSecret: 's3cr3t' });
		expect(testState.createOAuthClient).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({ token_endpoint_auth_method: 'client_secret_basic' }),
			}),
		);
	});

	it('creates a public client with no secret', async () => {
		testState.createOAuthClient.mockResolvedValue({ client_id: 'pub-id' });
		const result = await caller().mcpOAuthClients.create({
			name: 'cli',
			redirectUris: ['https://x/cb'],
			confidential: false,
		});
		expect(result).toEqual({ clientId: 'pub-id', clientSecret: null });
		expect(testState.createOAuthClient).toHaveBeenCalledWith(
			expect.objectContaining({ body: expect.objectContaining({ token_endpoint_auth_method: 'none' }) }),
		);
	});

	it('deletes a client by id and returns it', async () => {
		const result = await caller().mcpOAuthClients.delete({ clientId: 'c1' });
		expect(result).toEqual({ clientId: 'c1' });
		// Called once with a where condition (drizzle eq(), an opaque SQL object — the returned id
		// mirrors the requested client, confirming the handler targets it).
		expect(testState.deleteWhere).toHaveBeenCalledTimes(1);
		expect(testState.deleteWhere.mock.calls[0][0]).toBeDefined();
	});

	it('rejects non-admins', async () => {
		testState.role = 'user';
		await expect(caller().mcpOAuthClients.list()).rejects.toThrow(/admin/i);
	});
});
