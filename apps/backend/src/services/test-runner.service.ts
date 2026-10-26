import type { LlmSelectedModel } from '@nao/shared/types';

import type { DBTestRun, NewTestRunResult } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as testRunQueries from '../queries/test-run.queries';
import {
	MAX_TEST_RUN_ATTEMPTS,
	type TestComparisonTolerances,
	type TestDefinition,
	type TestRunResultDetails,
} from '../types/test-run';
import { resolveDefaultChatModel } from '../utils/llm';
import { logger } from '../utils/logger';
import { extractConfiguredTestSettings } from '../utils/nao-config';
import { mcpService } from './mcp';
import { skillService } from './skill';
import { testAgentService } from './test-agent.service';
import { evaluateTestAttempt, type TestAttemptEvaluation } from './test-evaluation.service';
import { discoverTests, filterTests } from './test-suite.service';

const TEST_RUN_CONCURRENCY = 3;
const TEST_RUN_STALE_MS = 6 * 60 * 60_000;
const TEST_RUN_STALE_MESSAGE = 'The test run was interrupted before it finished.';
const MAX_STORED_ROWS = 50;

/** Chats of the attempts in flight for each run, so a cancellation can stop them. */
const activeRunChats = new Map<string, Set<string>>();

export class TestRunInputError extends Error {}

export class TestRunConflictError extends Error {
	constructor() {
		super('A test run is already in progress.');
	}
}

export interface StartTestRunInput {
	projectId: string;
	userId: string;
	paths?: string[];
	tags?: string[];
	models?: LlmSelectedModel[];
	attempts?: number;
}

interface TestRunPlan {
	tests: TestDefinition[];
	models: LlmSelectedModel[];
	attempts: number;
	tolerances: TestComparisonTolerances;
}

interface TestAttemptJob {
	test: TestDefinition;
	model: LlmSelectedModel;
	attempt: number;
}

/** Creates a run against the production context and executes it in the background. */
export async function startTestRun(input: StartTestRunInput): Promise<DBTestRun> {
	const projectFolder = await getProjectFolder(input.projectId);
	await testRunQueries.failStaleRuns(input.projectId, TEST_RUN_STALE_MS, TEST_RUN_STALE_MESSAGE);
	if (await testRunQueries.hasActiveRun(input.projectId)) {
		throw new TestRunConflictError();
	}

	const plan = await planTestRun(input, projectFolder);
	const run = await testRunQueries.createRun({
		projectId: input.projectId,
		triggeredByUserId: input.userId,
		trigger: 'manual',
		models: plan.models,
		attempts: plan.attempts,
		selection: plan.tests.map((test) => test.path),
		totalAttempts: plan.tests.length * plan.models.length * plan.attempts,
	});

	void executeTestRun(run, input.userId, plan).catch((error) => {
		logger.error(`Test run ${run.id} crashed: ${String(error)}`, { source: 'agent', projectId: run.projectId });
	});
	return run;
}

export async function cancelTestRun(run: DBTestRun): Promise<boolean> {
	if (!(await testRunQueries.cancelRun(run.id))) {
		return false;
	}
	for (const chatId of activeRunChats.get(run.id) ?? []) {
		testAgentService.get(chatId)?.stop();
	}
	return true;
}

async function planTestRun(input: StartTestRunInput, projectFolder: string): Promise<TestRunPlan> {
	const tests = filterTests(discoverTests(projectFolder).tests, { paths: input.paths, tags: input.tags });
	if (tests.length === 0) {
		throw new TestRunInputError('No tests match the selection.');
	}

	const settings = extractConfiguredTestSettings(projectFolder);
	const models = input.models?.length ? input.models : (settings.models ?? (await resolveFallbackModels(input)));
	return {
		tests,
		models,
		attempts: Math.min(input.attempts ?? settings.attempts, MAX_TEST_RUN_ATTEMPTS),
		tolerances: settings.tolerances,
	};
}

async function resolveFallbackModels(input: StartTestRunInput): Promise<LlmSelectedModel[]> {
	const defaultModel = await resolveDefaultChatModel(input.projectId);
	if (!defaultModel) {
		throw new TestRunInputError('No LLM model is configured for this project.');
	}
	return [defaultModel];
}

async function executeTestRun(run: DBTestRun, userId: string, plan: TestRunPlan): Promise<void> {
	const jobs = buildAttemptJobs(plan);
	if (!(await testRunQueries.markRunRunning(run.id, jobs.length))) {
		return;
	}

	activeRunChats.set(run.id, new Set());
	try {
		await mcpService.initializeMcpState(run.projectId);
		await skillService.initializeSkills(run.projectId);
		await runWithConcurrency(jobs, TEST_RUN_CONCURRENCY, (job) =>
			runAttemptUnlessCancelled(run, userId, job, plan.tolerances),
		);
		await testRunQueries.completeRun(run.id);
	} catch (error) {
		await testRunQueries.failRun(run.id, error instanceof Error ? error.message : String(error));
	} finally {
		activeRunChats.delete(run.id);
	}
}

function buildAttemptJobs(plan: TestRunPlan): TestAttemptJob[] {
	return plan.tests.flatMap((test) =>
		plan.models.flatMap((model) =>
			Array.from({ length: plan.attempts }, (_, index) => ({ test, model, attempt: index + 1 })),
		),
	);
}

async function runAttemptUnlessCancelled(
	run: DBTestRun,
	userId: string,
	job: TestAttemptJob,
	tolerances: TestComparisonTolerances,
): Promise<void> {
	if ((await testRunQueries.getRunStatus(run.id)) !== 'running') {
		return;
	}
	const result = await runAttempt(run, userId, job, tolerances);
	if ((await testRunQueries.getRunStatus(run.id)) !== 'running') {
		return;
	}
	await testRunQueries.recordResult(result);
}

async function runAttempt(
	run: DBTestRun,
	userId: string,
	job: TestAttemptJob,
	tolerances: TestComparisonTolerances,
): Promise<NewTestRunResult> {
	const { test, model, attempt } = job;
	const baseResult = {
		runId: run.id,
		testPath: test.path,
		testName: test.name,
		testHash: test.hash,
		tags: test.tags,
		llmProvider: model.provider,
		llmModelId: model.modelId,
		attempt,
	};

	let chatId: string | null = null;
	try {
		const [chat] = await chatQueries.createChat(
			{ title: `Test: ${test.name}`, userId, projectId: run.projectId },
			{ text: test.prompt, source: 'test' },
		);
		chatId = chat.id;
		activeRunChats.get(run.id)?.add(chat.id);

		const [uiChat] = await chatQueries.getChat(chat.id);
		if (!uiChat) {
			throw new Error(`Test chat not found after creation: ${chat.id}`);
		}

		const agentResult = await testAgentService.runTestInChat(
			{ ...uiChat, userId, projectId: run.projectId },
			uiChat.messages,
			model,
			{ billingAccessVerifiedProjectId: run.projectId },
		);
		const evaluation = await evaluateTestAttempt({
			projectId: run.projectId,
			userId,
			test: { ...test, tolerances },
			result: agentResult,
			modelSelection: model,
		});

		return {
			...baseResult,
			chatId,
			passed: evaluation.verdict.passed,
			message: evaluation.verdict.message,
			totalTokens: agentResult.usage.totalTokens ?? null,
			totalCost: agentResult.cost.totalCost ?? null,
			durationMs: agentResult.durationMs,
			toolCallCount: evaluation.toolCalls.length,
			details: buildResultDetails(test, agentResult.text, evaluation),
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { ...baseResult, chatId, passed: false, message: `error: ${errorMessage}`, errorMessage };
	} finally {
		if (chatId) {
			activeRunChats.get(run.id)?.delete(chatId);
		}
	}
}

function buildResultDetails(
	test: TestDefinition,
	responseText: string,
	evaluation: TestAttemptEvaluation,
): TestRunResultDetails {
	return {
		responseText,
		actualData: evaluation.verification?.data?.slice(0, MAX_STORED_ROWS) ?? null,
		expectedData: evaluation.verification?.expectedData?.slice(0, MAX_STORED_ROWS) ?? null,
		comparison: evaluation.verdict.comparison,
		referenceSql: test.sql,
		verificationSql: evaluation.verification?.sql ?? null,
	};
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
	let nextIndex = 0;
	const runNext = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const item = items[nextIndex++];
			await worker(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}

async function getProjectFolder(projectId: string): Promise<string> {
	const project = await projectQueries.getProjectById(projectId);
	if (!project?.path) {
		throw new TestRunInputError('The project has no context folder.');
	}
	return project.path;
}
