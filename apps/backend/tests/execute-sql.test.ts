import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeQuery } from '../src/agents/tools/execute-sql';
import { env } from '../src/env';
import type { ToolContext } from '../src/types/tools';

vi.mock('../src/agents/tools/query-app-db', () => ({
	queryAppDb: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();

function createContext(dangerouslyWritePermEnabled = false): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		agentSettings: { sql: { dangerouslyWritePermEnabled } },
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], stories: [] },
	};
}

describe('executeQuery FastAPI request', () => {
	beforeEach(() => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [{ value: 1 }],
					row_count: 1,
					columns: ['value'],
					dialect: 'duckdb',
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	});

	it('authenticates read-only sidecar requests without write permission', async () => {
		await executeQuery({ sql_query: 'SELECT 1 AS value' }, createContext());

		const [, request] = fetchMock.mock.calls[0];
		expect(request?.headers).toEqual({
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		});
		expect(JSON.parse(request?.body as string)).toMatchObject({
			sql: 'SELECT 1 AS value',
			nao_project_folder: '/tmp/project',
			dangerously_write_permission_enabled: false,
		});
	});

	it('conveys enabled dangerous write permission to the authenticated sidecar', async () => {
		await executeQuery({ sql_query: 'DELETE FROM users' }, createContext(true));

		const [, request] = fetchMock.mock.calls[0];
		expect(request?.headers).toMatchObject({
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		});
		expect(JSON.parse(request?.body as string)).toMatchObject({
			dangerously_write_permission_enabled: true,
		});
	});
});
