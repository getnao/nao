import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	failStaleRuns: vi.fn(),
	hasActiveRun: vi.fn(),
	createRun: vi.fn(),
	markRunRunning: vi.fn(),
	getRunStatus: vi.fn(),
	recordResult: vi.fn(),
	completeRun: vi.fn(),
	failRun: vi.fn(),
	cancelRun: vi.fn(),
	createChat: vi.fn(),
	getChat: vi.fn(),
	runTestInChat: vi.fn(),
	getAgent: vi.fn(),
	evaluateTestAttempt: vi.fn(),
	resolveDefaultChatModel: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));
vi.mock('../src/queries/test-run.queries', () => ({
	failStaleRuns: mocks.failStaleRuns,
	hasActiveRun: mocks.hasActiveRun,
	createRun: mocks.createRun,
	markRunRunning: mocks.markRunRunning,
	getRunStatus: mocks.getRunStatus,
	recordResult: mocks.recordResult,
	completeRun: mocks.completeRun,
	failRun: mocks.failRun,
	cancelRun: mocks.cancelRun,
}));
vi.mock('../src/queries/chat.queries', () => ({ createChat: mocks.createChat, getChat: mocks.getChat }));
vi.mock('../src/services/test-agent.service', () => ({
	testAgentService: { runTestInChat: mocks.runTestInChat, get: mocks.getAgent },
}));
vi.mock('../src/services/test-evaluation.service', () => ({ evaluateTestAttempt: mocks.evaluateTestAttempt }));
vi.mock('../src/services/mcp', () => ({ mcpService: { initializeMcpState: vi.fn() } }));
vi.mock('../src/services/skill', () => ({ skillService: { initializeSkills: vi.fn() } }));
vi.mock('../src/utils/llm', () => ({ resolveDefaultChatModel: mocks.resolveDefaultChatModel }));
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
	cancelTestRun,
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
	mocks.hasActiveRun.mockResolvedValue(false);
	mocks.createRun.mockImplementation(async (input) => ({ id: 'run-1', status: 'queued', ...input }));
	mocks.markRunRunning.mockResolvedValue(true);
	mocks.getRunStatus.mockResolvedValue('running');
	mocks.resolveDefaultChatModel.mockResolvedValue(DEFAULT_MODEL);
	mocks.createChat.mockImplementation(async () => [{ id: `chat-${++chatCount}` }]);
	mocks.getChat.mockImplementation(async (chatId: string) => [{ id: chatId, messages: [] }]);
	mocks.runTestInChat.mockResolvedValue({
		text: 'The answer',
		usage: { totalTokens: 100 },
		cost: { totalCost: 0.01 },
		durationMs: 1200,
	});
	mocks.evaluateTestAttempt.mockResolvedValue({
		toolCalls: [{ toolName: 'execute_sql' }],
		verification: { data: [{ total: 1 }], expectedData: [{ total: 1 }], sql: 'select 1' },
		verdict: { passed: true, message: 'match', comparison: null },
	});
});

afterEach(() => {
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
		expect(mocks.createRun).toHaveBeenCalledWith(
			expect.objectContaining({ selection: ['revenue.yml'], attempts: 2, triggeredByUserId: 'user-1' }),
		);
		expect(mocks.markRunRunning).toHaveBeenCalledWith('run-1', 4);
		expect(mocks.createChat).toHaveBeenCalledWith(
			{ title: 'Test: revenue', userId: 'user-1', projectId: 'project-1' },
			{ text: 'What is the revenue?', source: 'test' },
		);
		expect(mocks.recordResult).toHaveBeenCalledTimes(4);
		expect(mocks.recordResult).toHaveBeenCalledWith(
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
				details: expect.objectContaining({ responseText: 'The answer', referenceSql: 'select 1' }),
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
		});
	});

	it('records a failed attempt when the agent errors, without failing the run', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.runTestInChat.mockRejectedValueOnce(new Error('rate limited'));

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.recordResult).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: 'chat-1',
				passed: false,
				message: 'error: rate limited',
				errorMessage: 'rate limited',
			}),
		);
	});

	it('stops recording attempts once the run is cancelled', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.getRunStatus.mockResolvedValueOnce('running').mockResolvedValue('cancelled');

		await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.completeRun).toHaveBeenCalled());

		expect(mocks.runTestInChat).toHaveBeenCalledTimes(1);
		expect(mocks.recordResult).not.toHaveBeenCalled();
	});

	it('rejects a run while another one is active', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		mocks.hasActiveRun.mockResolvedValue(true);

		await expect(startTestRun({ projectId: 'project-1', userId: 'user-1' })).rejects.toBeInstanceOf(
			TestRunConflictError,
		);
		expect(mocks.createRun).not.toHaveBeenCalled();
	});

	it('rejects a selection that matches no test', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');

		await expect(
			startTestRun({ projectId: 'project-1', userId: 'user-1', tags: ['unknown'] }),
		).rejects.toBeInstanceOf(TestRunInputError);
	});
});

describe('cancelTestRun', () => {
	it('stops the agents of the attempts in flight', async () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		const stop = vi.fn();
		mocks.getAgent.mockReturnValue({ stop });
		mocks.cancelRun.mockResolvedValue(true);
		let finishAttempt: () => void = () => {};
		mocks.runTestInChat.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishAttempt = () => resolve({ text: '', usage: {}, cost: {}, durationMs: 0 });
				}),
		);

		const run = await startTestRun({ projectId: 'project-1', userId: 'user-1' });
		await vi.waitFor(() => expect(mocks.runTestInChat).toHaveBeenCalled());

		await expect(cancelTestRun(run)).resolves.toBe(true);
		expect(mocks.getAgent).toHaveBeenCalledWith('chat-1');
		expect(stop).toHaveBeenCalled();
		finishAttempt();
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
