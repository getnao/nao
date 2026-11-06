import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	failStaleRuns: vi.fn(),
	recordHeartbeat: vi.fn(),
	createRunUnlessActive: vi.fn(),
	markRunRunning: vi.fn(),
	getRunStatus: vi.fn(),
	recordResultWhileRunning: vi.fn(),
	completeRun: vi.fn(),
	failRun: vi.fn(),
	cancelRun: vi.fn(),
	createChat: vi.fn(),
	getChat: vi.fn(),
	runTestInChat: vi.fn(),
	evaluateTestAttempt: vi.fn(),
	resolveDefaultChatModel: vi.fn(),
	getProjectAvailableModels: vi.fn(),
	resolveModelInferenceSettings: vi.fn(),
	createDraftContextSnapshot: vi.fn(),
	removeContextSnapshot: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));
vi.mock('../src/queries/test-run.queries', () => ({
	failStaleRuns: mocks.failStaleRuns,
	recordHeartbeat: mocks.recordHeartbeat,
	createRunUnlessActive: mocks.createRunUnlessActive,
	markRunRunning: mocks.markRunRunning,
	getRunStatus: mocks.getRunStatus,
	recordResultWhileRunning: mocks.recordResultWhileRunning,
	completeRun: mocks.completeRun,
	failRun: mocks.failRun,
	cancelRun: mocks.cancelRun,
}));
vi.mock('../src/queries/chat.queries', () => ({ createChat: mocks.createChat, getChat: mocks.getChat }));
vi.mock('../src/services/test-agent.service', () => ({
	testAgentService: { runTestInChat: mocks.runTestInChat },
}));
vi.mock('../src/services/test-evaluation.service', () => ({ evaluateTestAttempt: mocks.evaluateTestAttempt }));
vi.mock('../src/services/mcp', () => ({ mcpService: { initializeMcpState: vi.fn() } }));
vi.mock('../src/services/skill', () => ({ skillService: { initializeSkills: vi.fn() } }));
vi.mock('../src/services/user-group-llm-access.service', () => ({
	getAvailableModelsForUser: mocks.getProjectAvailableModels,
	getDefaultChatModelForUser: mocks.resolveDefaultChatModel,
	resolveUserModelSelection: vi.fn(async (_projectId, _userId, selection) => selection),
}));
vi.mock('../src/utils/llm', () => ({
	resolveDefaultChatModel: mocks.resolveDefaultChatModel,
	getProjectAvailableModels: mocks.getProjectAvailableModels,
	resolveModelInferenceSettings: mocks.resolveModelInferenceSettings,
}));
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../src/services/draft-context.service', () => ({
	createDraftContextSnapshot: mocks.createDraftContextSnapshot,
	removeContextSnapshot: mocks.removeContextSnapshot,
	removeContextSnapshotsOlderThan: vi.fn(),
}));

import { getModelReasoningEfforts } from '../src/agents/provider-meta';
import type { DraftSource } from '../src/services/draft-context.service';
import {
	cancelTestRun,
	listDefaultReasoningEfforts,
	startChangesRun,
	startComparisonRun,
	startTestRun,
	TestRunConflictError,
	TestRunInputError,
} from '../src/services/test-runner.service';

const DEFAULT_MODEL = { provider: 'openai', modelId: 'gpt-4.1' };

let projectFolder: string;
let chatCount: number;

beforeEach(() => {
	vi.clearAllMocks();
	projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-test-runner-'));
	chatCount = 0;
	mocks.getProjectById.mockResolvedValue({ id: 'project-1', path: projectFolder });
	mocks.createRunUnlessActive.mockImplementation(async (input) => ({ id: 'run-1', status: 'queued', ...input }));
	mocks.recordResultWhileRunning.mockResolvedValue(true);
	mocks.markRunRunning.mockResolvedValue(true);
	mocks.recordHeartbeat.mockResolvedValue(true);
	mocks.getRunStatus.mockResolvedValue('running');
	mocks.resolveDefaultChatModel.mockResolvedValue(DEFAULT_MODEL);
	mocks.createChat.mockImplementation(async () => [{ id: `chat-${++chatCount}` }]);
	mocks.getChat.mockImplementation(async (chatId: string) => [{ id: chatId, messages: [] }]);
	mocks.runTestInChat.mockResolvedValue({
		text: 'The answer',
		usage: { totalTokens: 100 },
		cost: { totalCost: 0.01 },
		durationMs: 1200,
		queryResults: new Map(),
	});
	mocks.evaluateTestAttempt.mockResolvedValue({
		toolCalls: [{ toolName: 'execute_sql' }],
		verification: {
			data: [{ total: 1 }],
			expectedData: [{ total: 1 }],
			expectedColumns: [],
			error: null,
			sql: 'select 1',
		},
		verdict: { passed: true, message: 'match', comparison: null },
	});
});

afterEach(() => {
	vi.useRealTimers();
	fs.rmSync(projectFolder, { recursive: true, force: true });
});

describe('startTestRun', () => {
	it('runs every selected test for each model and attempt, recording one result per attempt', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?\nsql: select 1\ntags: [finance]');
		writeTestFile('orders.yml', 'prompt: How many orders?\ntags: [sales]');
		writeConfig('test:\n  models: [openai:gpt-4.1, anthropic:claude-sonnet-4-5]\n  k: 2');

		const run = await startTestRun({ projectId: 'project-1', userId: 'user-1', tags: ['finance'] });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalledWith('run-1'));

		expect(run.totalAttempts).toBe(4);
		expect(mocks.createRunUnlessActive).toHaveBeenCalledWith(
			expect.objectContaining({ selection: ['revenue.yml'], attempts: 2, triggeredByUserId: 'user-1' }),
		);
		expect(mocks.markRunRunning).toHaveBeenCalledWith('run-1', 4);
		expect(mocks.createChat).toHaveBeenCalledWith(
			{ title: 'Test: revenue', userId: 'user-1', projectId: 'project-1' },
			{ text: 'What is the revenue?', source: 'test' },
		);
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledTimes(4);
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: 'run-1',
				testPath: 'revenue.yml',
				tags: ['finance'],
				llmProvider: 'anthropic',
				attempt: 2,
				passed: true,
				message: 'match',
				totalTokens: 100,
				totalCost: 0.01,
				toolCallCount: 1,
				details: expect.objectContaining({
					responseText: 'The answer',
					referenceSql: 'select 1',
					actualData: [{ total: 1 }],
					actualRowCount: 1,
				}),
			}),
		);
		expect(mocks.failRun).not.toHaveBeenCalled();
	});

	it('falls back to the project default model when nao_config pins none', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');

		const run = await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(run.models).toEqual([DEFAULT_MODEL]);
		expect(mocks.runTestInChat).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_MODEL, {
			billingAccessVerifiedProjectId: 'project-1',
			abortSignal: expect.any(AbortSignal),
		});
	});

	it('verifies the answers of every model with the project default model when several models run', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?\nsql: select 1');
		const models = [
			{ provider: 'anthropic', modelId: 'claude-haiku-4-5' },
			{ provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
		] as const;

		await startTestRun({ projectId: 'project-1', userId: 'user-1', models: [...models] });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.runTestInChat.mock.calls.map((call) => call[2])).toEqual([...models]);
		expect(mocks.evaluateTestAttempt.mock.calls.map((call) => call[0].verificationModel)).toEqual([
			DEFAULT_MODEL,
			DEFAULT_MODEL,
		]);
	});

	it('lets a single model verify its own answers', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?\nsql: select 1');
		const model = { provider: 'anthropic', modelId: 'claude-haiku-4-5' } as const;

		await startTestRun({ projectId: 'project-1', userId: 'user-1', models: [model] });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.evaluateTestAttempt).toHaveBeenCalledWith(expect.objectContaining({ verificationModel: model }));
	});

	it('lets a single model verify its own answers at the reasoning effort picked for it', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?\nsql: select 1');
		const model = { provider: 'anthropic', modelId: 'claude-opus-5-5' } as const;
		const [effort] = getModelReasoningEfforts(model.provider, model.modelId);

		await startTestRun({
			projectId: 'project-1',
			userId: 'user-1',
			models: [{ ...model, reasoningEfforts: [effort] }],
		});
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.evaluateTestAttempt).toHaveBeenCalledWith(
			expect.objectContaining({ verificationModel: { ...model, reasoningEffort: effort } }),
		);
	});

	it('keeps the queries the agent ran for a test without reference SQL', async () => {
		writeTestFile('orders.yml', 'prompt: How many orders?');
		mocks.runTestInChat.mockResolvedValueOnce({
			text: 'There are 3 orders',
			usage: {},
			cost: {},
			durationMs: 0,
			queryResults: new Map([
				['query_1', { columns: ['count'], data: [{ count: 3 }], sqlQuery: 'SELECT count(*) FROM orders' }],
				['query_2', { columns: ['count'], data: [{ count: 3 }] }],
			]),
		});
		mocks.evaluateTestAttempt.mockResolvedValueOnce({
			toolCalls: [{ toolName: 'execute_sql' }],
			verification: undefined,
			verdict: { passed: true, message: 'assertions passed', comparison: null },
		});

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(
			expect.objectContaining({
				details: expect.objectContaining({
					verificationSql: null,
					sourceQueries: [{ id: 'query_1', sql: 'SELECT count(*) FROM orders' }],
				}),
			}),
		);
	});

	it('runs a model once per reasoning effort picked, from the lowest, verified by the default model', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?\nsql: select 1');
		const model = { provider: 'anthropic', modelId: 'claude-opus-5-5' } as const;
		const efforts = getModelReasoningEfforts(model.provider, model.modelId);
		const variants = efforts.map((reasoningEffort) => ({ ...model, reasoningEffort }));

		const run = await startTestRun({
			projectId: 'project-1',
			userId: 'user-1',
			models: [{ ...model, reasoningEfforts: [...efforts].reverse() }],
		});
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(efforts.length).toBeGreaterThan(1);
		expect(run.models).toEqual(variants);
		expect(mocks.runTestInChat.mock.calls.map((call) => call[2])).toEqual(variants);
		expect(mocks.recordResultWhileRunning.mock.calls.map((call) => call[0].reasoningEffort)).toEqual(efforts);
		expect(mocks.evaluateTestAttempt).toHaveBeenCalledWith(
			expect.objectContaining({ verificationModel: DEFAULT_MODEL }),
		);
	});

	it('runs a model without reasoning efforts once, even when picked with some', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		const model = { provider: 'openai', modelId: 'gpt-4.1' } as const;

		const run = await startTestRun({
			projectId: 'project-1',
			userId: 'user-1',
			models: [{ ...model, reasoningEfforts: ['high'] }],
		});
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(run.models).toEqual([model]);
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: null }));
	});

	it('records a failed attempt when the agent errors, without failing the run', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.runTestInChat.mockRejectedValueOnce(new Error('rate limited'));

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: 'chat-1',
				passed: false,
				message: 'error: rate limited',
				errorMessage: 'rate limited',
			}),
		);
	});

	it('starts no further attempt once the run is cancelled', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		writeConfig('test:\n  k: 3');
		mocks.getRunStatus.mockResolvedValueOnce('running').mockResolvedValue('cancelled');

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.runTestInChat).toHaveBeenCalledTimes(1);
	});

	it('fails the run only once the attempts in flight have settled', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		writeConfig('test:\n  k: 2');
		let finishSecondAttempt: () => void = () => {};
		mocks.runTestInChat
			.mockResolvedValueOnce({ text: '', usage: {}, cost: {}, durationMs: 0, queryResults: new Map() })
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishSecondAttempt = () =>
							resolve({ text: '', usage: {}, cost: {}, durationMs: 0, queryResults: new Map() });
					}),
			);
		mocks.recordResultWhileRunning.mockRejectedValueOnce(new Error('database unavailable'));

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.recordResultWhileRunning).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(mocks.runTestInChat).toHaveBeenCalledTimes(2));

		expect(mocks.failRun).not.toHaveBeenCalled();
		finishSecondAttempt();
		await vi.waitFor(() => expect(mocks.failRun).toHaveBeenCalledWith('run-1', 'database unavailable'));
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledTimes(2);
	});

	it('rejects a run while another one is active', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.createRunUnlessActive.mockResolvedValue(null);

		await expect(startTestRun({ projectId: 'project-1', userId: 'user-1' })).rejects.toBeInstanceOf(
			TestRunConflictError,
		);
		expect(mocks.markRunRunning).not.toHaveBeenCalled();
	});

	it('rejects a run that covers an invalid test file, as nao test does', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		writeTestFile('broken.yml', 'name: Missing prompt');

		await expect(startTestRun({ projectId: 'project-1', userId: 'user-1' })).rejects.toThrow(
			'Fix the invalid test files first: broken.yml',
		);
		await expect(
			startTestRun({ projectId: 'project-1', userId: 'user-1', paths: ['revenue.yml'] }),
		).resolves.toMatchObject({ id: 'run-1' });
	});

	it('rejects a run when the test settings of nao_config.yaml are invalid', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		writeConfig('test:\n  models: [nocolon]');

		await expect(startTestRun({ projectId: 'project-1', userId: 'user-1' })).rejects.toThrow(
			'test.models has an invalid entry "nocolon", expected \'provider:model_id\'.',
		);
		expect(mocks.createRunUnlessActive).not.toHaveBeenCalled();
	});

	it('runs the given draft tests instead of the context ones, as a draft run', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		const draft = {
			path: 'revenue.yml',
			name: 'revenue',
			prompt: 'What is the revenue in 2026?',
			sql: null,
			databaseId: null,
			assertions: [],
			tags: [],
			owner: null,
			hash: 'draft-hash',
		};

		await startTestRun({ projectId: 'project-1', userId: 'user-1', tests: [draft] });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.createRunUnlessActive).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'draft', selection: ['revenue.yml'] }),
		);
		expect(mocks.createChat).toHaveBeenCalledWith(expect.anything(), {
			text: 'What is the revenue in 2026?',
			source: 'test',
		});
	});

	it('rejects a selection that matches no test', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');

		await expect(
			startTestRun({ projectId: 'project-1', userId: 'user-1', tags: ['unknown'] }),
		).rejects.toBeInstanceOf(TestRunInputError);
	});
});

describe('startComparisonRun', () => {
	let draftFolder: string;

	beforeEach(() => {
		draftFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-test-draft-'));
		mocks.createDraftContextSnapshot.mockReturnValue({
			folder: draftFolder,
			branch: 'improve-revenue',
			productionBranch: 'main',
			productionCommit: 'abc123',
			changes: [{ path: 'RULES.md', kind: 'modified' }],
			excludedChanges: [],
			outdatedPaths: [],
		});
	});

	afterEach(() => {
		fs.rmSync(draftFolder, { recursive: true, force: true });
	});

	it('runs each attempt of the draft tests against production and the draft, then removes the snapshot', async () => {
		writeTestFile('revenue.yml', 'prompt: An outdated production prompt');
		writeDraftTestFile('revenue.yml', 'prompt: What is the revenue?');
		writeDraftTestFile('margin.yml', 'prompt: What is the margin?');

		const run = await startComparisonRun({ projectId: 'project-1', userId: 'user-1', draft: gitDraft() });
		await vi.waitFor(() => expect(mocks.removeContextSnapshot).toHaveBeenCalledWith(draftFolder));

		expect(run.totalAttempts).toBe(4);
		expect(mocks.createRunUnlessActive).toHaveBeenCalledWith(
			expect.objectContaining({
				trigger: 'comparison',
				contextRef: 'improve-revenue',
				contextCommit: 'abc123',
				contextChanges: [{ path: 'RULES.md', kind: 'modified' }],
				selection: ['margin.yml', 'revenue.yml'],
			}),
		);
		const contextFolders = mocks.runTestInChat.mock.calls.map(([, , , options]) => options.contextFolder);
		expect(contextFolders.filter((folder) => folder === draftFolder)).toHaveLength(2);
		expect(contextFolders.filter((folder) => folder === undefined)).toHaveLength(2);
		expect(mocks.createChat).toHaveBeenCalledWith(
			{ title: 'Test: revenue (draft context)', userId: 'user-1', projectId: 'project-1' },
			{ text: 'What is the revenue?', source: 'test' },
		);
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(
			expect.objectContaining({ testPath: 'revenue.yml', contextVariant: 'draft' }),
		);
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(
			expect.objectContaining({ testPath: 'revenue.yml', contextVariant: 'production' }),
		);
	});

	it('compares only the given tests, as they are in the editor', async () => {
		writeDraftTestFile('revenue.yml', 'prompt: What is the revenue?');
		writeDraftTestFile('margin.yml', 'prompt: What is the margin?');
		const editedTest = {
			path: 'revenue.yml',
			name: 'revenue',
			prompt: 'What is the revenue in 2026?',
			sql: null,
			databaseId: null,
			assertions: [],
			tags: [],
			owner: null,
			hash: 'edited-hash',
		};

		const run = await startComparisonRun({
			projectId: 'project-1',
			userId: 'user-1',
			draft: gitDraft(),
			tests: [editedTest],
		});
		await vi.waitFor(() => expect(mocks.removeContextSnapshot).toHaveBeenCalledWith(draftFolder));

		expect(run.totalAttempts).toBe(2);
		expect(mocks.createRunUnlessActive).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'comparison', selection: ['revenue.yml'] }),
		);
		expect(mocks.createChat).toHaveBeenCalledWith(expect.anything(), {
			text: 'What is the revenue in 2026?',
			source: 'test',
		});
	});

	it('runs the given tests against the draft only when not comparing', async () => {
		writeDraftTestFile('revenue.yml', 'prompt: What is the revenue?');

		const run = await startChangesRun({ projectId: 'project-1', userId: 'user-1', draft: gitDraft() });
		await vi.waitFor(() => expect(mocks.removeContextSnapshot).toHaveBeenCalledWith(draftFolder));

		expect(run.totalAttempts).toBe(1);
		expect(mocks.createRunUnlessActive).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'changes', contextChanges: [{ path: 'RULES.md', kind: 'modified' }] }),
		);
		const contextFolders = mocks.runTestInChat.mock.calls.map(([, , , options]) => options.contextFolder);
		expect(contextFolders).toEqual([draftFolder]);
		expect(mocks.recordResultWhileRunning).toHaveBeenCalledWith(
			expect.objectContaining({ testPath: 'revenue.yml', contextVariant: 'draft' }),
		);
	});

	it('rejects a draft without changes and removes its snapshot', async () => {
		writeDraftTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.createDraftContextSnapshot.mockReturnValue({
			folder: draftFolder,
			branch: null,
			productionCommit: 'abc123',
			changes: [],
			excludedChanges: [{ path: 'nao_config.yaml', kind: 'modified' }],
			outdatedPaths: [],
		});

		await expect(
			startComparisonRun({ projectId: 'project-1', userId: 'user-1', draft: gitDraft() }),
		).rejects.toBeInstanceOf(TestRunInputError);
		expect(mocks.removeContextSnapshot).toHaveBeenCalledWith(draftFolder);
		expect(mocks.createRunUnlessActive).not.toHaveBeenCalled();
	});

	it('removes the snapshot when another run is active', async () => {
		writeDraftTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.createRunUnlessActive.mockResolvedValue(null);

		await expect(
			startComparisonRun({ projectId: 'project-1', userId: 'user-1', draft: gitDraft() }),
		).rejects.toBeInstanceOf(TestRunConflictError);
		expect(mocks.removeContextSnapshot).toHaveBeenCalledWith(draftFolder);
	});

	function writeDraftTestFile(relativePath: string, content: string) {
		const filePath = path.join(draftFolder, 'tests', relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
});

describe('cancelTestRun', () => {
	it('aborts the attempts in flight, including those still setting up their agent', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.cancelRun.mockResolvedValue(true);
		let abortSignal: AbortSignal | undefined;
		let finishAttempt: () => void = () => {};
		mocks.runTestInChat.mockImplementation(
			(_chat, _messages, _model, options: { abortSignal: AbortSignal }) =>
				new Promise((resolve) => {
					abortSignal = options.abortSignal;
					finishAttempt = () =>
						resolve({ text: '', usage: {}, cost: {}, durationMs: 0, queryResults: new Map() });
				}),
		);

		const run = await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.runTestInChat).toHaveBeenCalled());

		await expect(cancelTestRun(run)).resolves.toBe(true);
		expect(abortSignal?.aborted).toBe(true);
		finishAttempt();
		await vi.waitFor(() => expect(mocks.recordResultWhileRunning).toHaveBeenCalled());
		expect(mocks.evaluateTestAttempt).not.toHaveBeenCalled();
	});

	it('aborts the attempts in flight once the heartbeat finds the run cancelled by another replica', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.recordHeartbeat.mockResolvedValue(false);
		let abortSignal: AbortSignal | undefined;
		let finishAttempt: () => void = () => {};
		mocks.runTestInChat.mockImplementation(
			(_chat, _messages, _model, options: { abortSignal: AbortSignal }) =>
				new Promise((resolve) => {
					abortSignal = options.abortSignal;
					finishAttempt = () => resolve({ text: '', usage: {}, cost: {}, durationMs: 0 });
				}),
		);

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.runTestInChat).toHaveBeenCalled());
		await vi.runOnlyPendingTimersAsync();

		expect(abortSignal?.aborted).toBe(true);
		finishAttempt();
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());
	});
});

describe('listDefaultReasoningEfforts', () => {
	it('gives each model with reasoning efforts the effort its settings run it at', async () => {
		mocks.getProjectAvailableModels.mockResolvedValue([
			{ provider: 'anthropic', modelId: 'claude-opus-5-5' },
			{ provider: 'anthropic', modelId: 'claude-sonnet-5' },
			{ provider: 'openai', modelId: 'gpt-4.1' },
		]);
		mocks.resolveModelInferenceSettings.mockImplementation(async (_projectId, _provider, modelId) =>
			modelId === 'claude-opus-5-5' ? { reasoningEffort: 'high' } : {},
		);

		expect(await listDefaultReasoningEfforts('project-1')).toEqual([
			{ provider: 'anthropic', modelId: 'claude-opus-5-5', reasoningEffort: 'high' },
			{ provider: 'anthropic', modelId: 'claude-sonnet-5', reasoningEffort: null },
		]);
	});
});

function writeTestFile(relativePath: string, content: string) {
	const filePath = path.join(projectFolder, 'tests', relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

function writeConfig(content: string) {
	fs.writeFileSync(path.join(projectFolder, 'nao_config.yaml'), content);
}

function gitDraft(): DraftSource {
	return {
		context: {
			storage: 'git',
			branch: 'improve-revenue',
			productionBranch: 'main',
			productionCommit: 'abc123',
			changes: [{ path: 'RULES.md', kind: 'modified' }],
			excludedChanges: [],
			outdatedPaths: [],
		},
		readChangedFile: () => null,
	};
}
