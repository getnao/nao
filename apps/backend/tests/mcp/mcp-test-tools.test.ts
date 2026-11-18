import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getUser: vi.fn(),
	getRun: vi.fn(),
	listResultOutcomes: vi.fn(),
	getLatestOutcomesByTest: vi.fn(),
	listRunsWithTestTotals: vi.fn(),
	startRunInMode: vi.fn(),
	cancelTestRun: vi.fn(),
	failStaleTestRuns: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));
vi.mock('../../src/queries/user.queries', () => ({ getUser: mocks.getUser }));
vi.mock('../../src/queries/test-run.queries', () => ({
	getRun: mocks.getRun,
	listResultOutcomes: mocks.listResultOutcomes,
}));
vi.mock('../../src/services/test-history.service', () => ({
	getLatestOutcomesByTest: mocks.getLatestOutcomesByTest,
	listRunsWithTestTotals: mocks.listRunsWithTestTotals,
}));
vi.mock('../../src/services/test-run-start.service', () => ({ startRunInMode: mocks.startRunInMode }));
vi.mock('../../src/services/test-runner.service', () => ({
	cancelTestRun: mocks.cancelTestRun,
	failStaleTestRuns: mocks.failStaleTestRuns,
}));

import { BASELINE_TOOL, listToolNames, useContextAdminMcpClient } from '../helpers/context-admin-mcp-client';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const TEST_TOOLS = ['list_tests', 'run_tests', 'list_test_runs', 'get_test_run', 'cancel_test_run'];

const connect = useContextAdminMcpClient();
const createTemporaryFolder = useTemporaryFolders();
let projectFolder: string;

beforeEach(() => {
	projectFolder = createTemporaryFolder('nao-mcp-tests-');
	mocks.getProjectById.mockResolvedValue({ id: 'project-1', path: projectFolder });
	mocks.getUser.mockResolvedValue({ id: 'user-1', name: 'Alice', email: 'alice@example.com' });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('MCP test tools registration', () => {
	it.each<McpUserRole>(['admin', 'context_admin'])('exposes them to %s', async (role) => {
		const client = await connect(role);

		expect(await listToolNames(client)).toEqual(expect.arrayContaining(TEST_TOOLS));
	});

	it('hides them from regular users', async () => {
		const client = await connect('user');

		expect(await listToolNames(client)).toEqual([BASELINE_TOOL]);
	});
});

describe('MCP list_tests', () => {
	it('lists the tests of the project with their latest outcome and the unreadable files', async () => {
		writeTestFile('revenue.yml', 'name: Revenue\nprompt: What is the revenue?\nsql: select 1\ntags: [finance]\n');
		writeTestFile('broken.yml', 'prompt: [unclosed\n');
		mocks.getLatestOutcomesByTest.mockResolvedValue({
			'revenue.yml': { runId: 'run-1', passedAttempts: 1, totalAttempts: 2, isOutdated: false, models: [] },
		});
		const client = await connect('context_admin');

		const result = await client.callTool({ name: 'list_tests', arguments: {} });

		const output = result.structuredContent as {
			tests: Array<Record<string, unknown>>;
			invalidFiles: Array<{ path: string }>;
		};
		expect(output.tests).toEqual([
			{
				path: 'revenue.yml',
				name: 'Revenue',
				prompt: 'What is the revenue?',
				tags: ['finance'],
				owner: null,
				hasReferenceSql: true,
				latestOutcome: { runId: 'run-1', passedAttempts: 1, totalAttempts: 2, isOutdated: false },
			},
		]);
		expect(output.invalidFiles.map((file) => file.path)).toEqual(['broken.yml']);
	});
});

describe('MCP run_tests', () => {
	it('starts a run as the caller, with the changes of the synced repo branch given', async () => {
		mocks.startRunInMode.mockResolvedValue(testRun({ id: 'run-2', trigger: 'comparison' }));
		const client = await connect('admin');
		const upstream = { repo: 'business', branch: 'analyst/margin' };

		const result = await client.callTool({
			name: 'run_tests',
			arguments: { mode: 'compare', paths: ['revenue.yml'], upstream },
		});

		expect(mocks.startRunInMode).toHaveBeenCalledWith({
			mode: 'compare',
			run: { projectId: 'project-1', userId: 'user-1', paths: ['revenue.yml'] },
			upstream,
			reader: {
				projectId: 'project-1',
				projectFolder,
				user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
			},
		});
		expect(result.structuredContent).toMatchObject({ runId: 'run-2', run: { trigger: 'comparison' } });
	});

	it('returns why the run cannot start', async () => {
		mocks.startRunInMode.mockRejectedValue(new Error('No tests match the selection.'));
		const client = await connect('admin');

		const result = await client.callTool({ name: 'run_tests', arguments: { paths: ['missing.yml'] } });

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: 'text', text: 'No tests match the selection.' }]);
	});
});

describe('MCP get_test_run', () => {
	it('compares each test, a test the changes add being new', async () => {
		mocks.getRun.mockResolvedValue(
			testRun({ trigger: 'comparison', contextChanges: [{ path: 'tests/margin.yml', kind: 'added' }] }),
		);
		mocks.listResultOutcomes.mockResolvedValue([
			result({ testPath: 'revenue.yml', contextVariant: 'production', passed: true }),
			result({ testPath: 'revenue.yml', contextVariant: 'draft', passed: false, message: 'Wrong total' }),
			result({ testPath: 'margin.yml', contextVariant: 'draft', passed: true }),
		]);
		const client = await connect('admin');

		const response = await client.callTool({ name: 'get_test_run', arguments: { run_id: 'run-1' } });

		const output = response.structuredContent as {
			tests: Array<{ testPath: string; firstFailure: string | null }>;
			comparison: { tests: Array<{ testPath: string; change: string }> };
		};
		expect(output.comparison.tests.map(({ testPath, change }) => [testPath, change])).toEqual([
			['revenue.yml', 'regressed'],
			['margin.yml', 'new'],
		]);
		expect(output.tests.find((test) => test.testPath === 'revenue.yml')?.firstFailure).toBe('Wrong total');
	});

	it('fails a run left behind by a restart before reading it, so polling reaches a final status', async () => {
		mocks.getRun.mockResolvedValue(testRun({ status: 'failed' }));
		mocks.listResultOutcomes.mockResolvedValue([]);
		const client = await connect('admin');

		await client.callTool({ name: 'get_test_run', arguments: { run_id: 'run-1' } });

		expect(mocks.failStaleTestRuns).toHaveBeenCalledWith('project-1');
		expect(mocks.failStaleTestRuns.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.getRun.mock.invocationCallOrder[0],
		);
	});

	it('refuses a run of another project', async () => {
		mocks.getRun.mockResolvedValue(null);
		const client = await connect('admin');

		const response = await client.callTool({ name: 'get_test_run', arguments: { run_id: 'run-9' } });

		expect(response.isError).toBe(true);
		expect(mocks.getRun).toHaveBeenCalledWith('project-1', 'run-9');
	});
});

function writeTestFile(relativePath: string, content: string) {
	const filePath = path.join(projectFolder, 'tests', relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

function testRun(overrides: Record<string, unknown>) {
	return {
		id: 'run-1',
		status: 'running',
		trigger: 'manual',
		contextRef: null,
		contextChanges: null,
		models: [{ provider: 'openai', modelId: 'gpt-4.1' }],
		attempts: 1,
		selection: ['revenue.yml'],
		completedAttempts: 0,
		totalAttempts: 1,
		errorMessage: null,
		createdAt: new Date('2026-11-17T10:00:00.000Z'),
		...overrides,
	};
}

function result(overrides: { testPath: string; contextVariant: string; passed: boolean; message?: string }) {
	return {
		testName: overrides.testPath.replace('.yml', ''),
		message: overrides.message ?? 'match',
		errorMessage: null,
		...overrides,
	};
}
