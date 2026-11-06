import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { getModelCapabilities, getModelReasoningEfforts } from '../agents/provider-meta';
import { clampEffort } from '../agents/providers';
import type { DBTestRun, NewTestRun, NewTestRunResult } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as testRunQueries from '../queries/test-run.queries';
import type { ReasoningEffort } from '../types/llm';
import {
	getDefaultTestRunThreads,
	type InvalidTestFile,
	MAX_TEST_RUN_ATTEMPTS,
	MAX_TEST_RUN_THREADS,
	TEST_CONTEXT_VARIANTS,
	type TestComparisonTolerances,
	type TestContextVariant,
	type TestDefinition,
	type TestModel,
	type TestModelDefaultEffort,
	type TestModelSelection,
	type TestRunResultDetails,
	type TestSourceQuery,
	type TestSuite,
} from '../types/test-run';
import { resolveModelInferenceSettings } from '../utils/llm';
import { logger } from '../utils/logger';
import { extractConfiguredTestSettings } from '../utils/nao-config';
import { comparedColumns, orderRecordsForComparison } from '../utils/test-data-comparison';
import type { AgentRunResult } from './agent';
import {
	createDraftContextSnapshot,
	type DraftSource,
	removeContextSnapshot,
	removeContextSnapshotsOlderThan,
} from './draft-context.service';
import { mcpService } from './mcp';
import { skillService } from './skill';
import { testAgentService } from './test-agent.service';
import { evaluateTestAttempt, type TestAttemptEvaluation } from './test-evaluation.service';
import { discoverTests, filterTests } from './test-suite.service';
import {
	getAvailableModelsForUser,
	getDefaultChatModelForUser,
	resolveUserModelSelection,
} from './user-group-llm-access.service';

const TEST_RUN_HEARTBEAT_MS = 30_000;
/** Several missed heartbeats, so that a slow database write does not fail a run that is still executing. */
const TEST_RUN_STALE_MS = 4 * TEST_RUN_HEARTBEAT_MS;
/** Snapshots left by a crashed process are removed once older than any run lasts, as another process's run may read one. */
const CONTEXT_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60_000;
const TEST_RUN_STALE_MESSAGE = 'The test run was interrupted before it finished.';
const MAX_STORED_ROWS = 50;
const NO_CONTEXT_CHANGES_MESSAGE = 'Your File Explorer has no context changes to compare.';

/** Runs this process is executing, so a cancellation can stop their attempts. */
const liveRuns = new Map<string, AbortController>();

export class TestRunInputError extends Error {}

export class TestRunConflictError extends Error {
	constructor() {
		super('A test run is already in progress.');
	}
}

interface StartTestRunInput {
	projectId: string;
	userId: string;
	paths?: string[];
	tags?: string[];
	models?: TestModelSelection[];
	attempts?: number;
	threads?: number;
	/** Tests to run instead of the ones of the production context, such as a draft being edited. */
	tests?: TestDefinition[];
}

interface StartComparisonRunInput extends StartTestRunInput {
	/** The user's File Explorer changes, tested against the production context. */
	draft: DraftSource;
}

interface TestSuitePlan {
	tests: TestDefinition[];
	/** Each picked model, once per reasoning effort when it runs at all of them. */
	models: TestModel[];
	/**
	 * Writes the verification query of every attempt when several models run, so that the comparison measures their
	 * answers rather than how well each writes that query. Null when one model runs and verifies its own answers.
	 */
	verificationModel: LlmSelectedModel | null;
	attempts: number;
	/** How many attempts are in flight at once. */
	threads: number;
	tolerances: TestComparisonTolerances;
}

interface TestRunPlan extends TestSuitePlan {
	variants: TestContextVariant[];
	draftFolder: string | null;
}

type TestRunContext = Pick<NewTestRun, 'trigger' | 'contextRef' | 'contextCommit' | 'contextChanges'>;

interface TestAttemptJob {
	test: TestDefinition;
	model: TestModel;
	attempt: number;
	variant: TestContextVariant;
}

/** Creates a run against the production context and executes it in the background. */
export async function startTestRun(input: StartTestRunInput): Promise<DBTestRun> {
	const projectFolder = await getProjectFolder(input.projectId);
	await failStaleTestRuns(input.projectId);

	const suite = input.tests ? { tests: input.tests, invalidFiles: [] } : discoverTests(projectFolder);
	const plan = await planTestRun(input, projectFolder, suite);
	return createAndExecuteRun(
		input,
		{ ...plan, variants: ['production'], draftFolder: null },
		{ trigger: input.tests ? 'draft' : 'manual' },
	);
}

/**
 * Runs the tests of the user's draft, or the given ones, against both the production context and the production
 * context with the user's changes, interleaving the attempts so both variants face the same warehouse data and model.
 */
export async function startComparisonRun(input: StartComparisonRunInput): Promise<DBTestRun> {
	return startDraftContextRun(input, [...TEST_CONTEXT_VARIANTS], 'comparison');
}

/** Runs the tests of the user's draft, or the given ones, against the production context with the user's changes. */
export async function startChangesRun(input: StartComparisonRunInput): Promise<DBTestRun> {
	return startDraftContextRun(input, ['draft'], 'changes');
}

async function startDraftContextRun(
	input: StartComparisonRunInput,
	variants: TestContextVariant[],
	trigger: 'comparison' | 'changes',
): Promise<DBTestRun> {
	const projectFolder = await getProjectFolder(input.projectId);
	await failStaleTestRuns(input.projectId);

	const snapshot = createDraftContextSnapshot({ projectId: input.projectId, projectFolder, draft: input.draft });
	let run: DBTestRun;
	try {
		if (snapshot.changes.length === 0) {
			throw new TestRunInputError(NO_CONTEXT_CHANGES_MESSAGE);
		}
		const suite = input.tests ? { tests: input.tests, invalidFiles: [] } : discoverTests(snapshot.folder);
		const plan = await planTestRun(input, projectFolder, suite);
		run = await createAndExecuteRun(
			input,
			{ ...plan, variants, draftFolder: snapshot.folder },
			{
				trigger,
				contextRef: snapshot.branch,
				contextCommit: snapshot.productionCommit,
				contextChanges: snapshot.changes,
			},
		);
	} catch (error) {
		removeContextSnapshot(snapshot.folder);
		throw error;
	}
	removeLeftoverContextSnapshots(projectFolder, input.projectId);
	return run;
}

/** Runs only once this run is the project's active one, so no other run of the project can still read a snapshot. */
function removeLeftoverContextSnapshots(projectFolder: string, projectId: string): void {
	try {
		removeContextSnapshotsOlderThan(projectFolder, projectId, CONTEXT_SNAPSHOT_MAX_AGE_MS);
	} catch (error) {
		logger.error(`Could not remove leftover test context snapshots: ${String(error)}`, {
			source: 'agent',
			projectId,
		});
	}
}

export async function cancelTestRun(run: DBTestRun): Promise<boolean> {
	if (!(await testRunQueries.cancelRun(run.id))) {
		return false;
	}
	liveRuns.get(run.id)?.abort();
	return true;
}

/** Runs left active by a stopped process would otherwise show as in progress and block new runs. */
export async function failStaleTestRuns(projectId: string): Promise<void> {
	await testRunQueries.failStaleRuns({
		projectId,
		staleAfterMs: TEST_RUN_STALE_MS,
		errorMessage: TEST_RUN_STALE_MESSAGE,
	});
}

async function createAndExecuteRun(
	input: Pick<StartTestRunInput, 'projectId' | 'userId'>,
	plan: TestRunPlan,
	context: TestRunContext,
): Promise<DBTestRun> {
	const run = await testRunQueries.createRunUnlessActive({
		projectId: input.projectId,
		triggeredByUserId: input.userId,
		...context,
		models: plan.models,
		attempts: plan.attempts,
		selection: plan.tests.map((test) => test.path),
		totalAttempts: plan.tests.length * plan.models.length * plan.attempts * plan.variants.length,
	});
	if (!run) {
		throw new TestRunConflictError();
	}

	void executeTestRun(run, input.userId, plan)
		.catch((error) => {
			logger.error(`Test run ${run.id} crashed: ${String(error)}`, { source: 'agent', projectId: run.projectId });
		})
		.finally(() => {
			if (plan.draftFolder) {
				removeContextSnapshot(plan.draftFolder);
			}
		});
	return run;
}

async function planTestRun(
	input: Omit<StartTestRunInput, 'tests'>,
	projectFolder: string,
	suite: TestSuite,
): Promise<TestSuitePlan> {
	const invalidFiles = selectInvalidFiles(suite.invalidFiles, input.paths);
	if (invalidFiles.length > 0) {
		throw new TestRunInputError(
			`Fix the invalid test files first: ${invalidFiles.map((file) => file.path).join(', ')}`,
		);
	}
	const tests = filterTests(suite.tests, { paths: input.paths, tags: input.tags });
	if (tests.length === 0) {
		throw new TestRunInputError('No tests match the selection.');
	}

	const settings = extractConfiguredTestSettings(projectFolder);
	if (settings.errors.length > 0) {
		throw new TestRunInputError(`Fix the test settings in nao_config.yaml first: ${settings.errors.join(' ')}`);
	}
	const requestedSelections = input.models?.length
		? input.models
		: (settings.models ?? (await resolveFallbackModels(input)));
	const selections = await Promise.all(
		requestedSelections.map(async (selection) => {
			const reasoningEfforts = (selection as TestModelSelection).reasoningEfforts;
			const resolved = await resolveUserModelSelection(input.projectId, input.userId, selection);
			return reasoningEfforts ? { ...resolved, reasoningEfforts } : resolved;
		}),
	);
	const models = expandReasoningEfforts(selections);
	return {
		tests,
		models,
		verificationModel:
			models.length > 1 ? await resolveVerificationModel(input.projectId, input.userId, models) : null,
		attempts: Math.min(input.attempts ?? settings.attempts, MAX_TEST_RUN_ATTEMPTS),
		threads: Math.min(
			input.threads ?? settings.threads ?? getDefaultTestRunThreads(models.length),
			MAX_TEST_RUN_THREADS,
		),
		tolerances: settings.tolerances,
	};
}

/** The effort each available model that has reasoning efforts runs at when a run keeps its settings. */
export async function listDefaultReasoningEfforts(
	projectId: string,
	userId: string,
): Promise<TestModelDefaultEffort[]> {
	const models = (await getAvailableModelsForUser(projectId, userId)).filter(
		(model) => getModelReasoningEfforts(model.provider, model.modelId).length > 0,
	);
	return Promise.all(
		models.map(async ({ provider, modelId, llmConfigId }) => {
			const settings = await resolveModelInferenceSettings(projectId, provider, modelId, llmConfigId);
			return {
				provider,
				modelId,
				...(llmConfigId && { llmConfigId }),
				reasoningEffort: toEffectiveEffort(provider, modelId, settings.reasoningEffort),
			};
		}),
	);
}

/** A model runs once per reasoning effort picked that it supports, from the lowest, or once when none is. */
function expandReasoningEfforts(selections: TestModelSelection[]): TestModel[] {
	return selections.flatMap(({ reasoningEfforts = [], ...model }) => {
		const efforts = getModelReasoningEfforts(model.provider, model.modelId).filter((effort) =>
			reasoningEfforts.includes(effort),
		);
		return efforts.length > 0 ? efforts.map((reasoningEffort) => ({ ...model, reasoningEffort })) : [model];
	});
}

/** The stored effort as the provider receives it, snapped to the efforts the model supports. */
function toEffectiveEffort(
	provider: LlmProvider,
	modelId: string,
	effort: ReasoningEffort | undefined,
): ReasoningEffort | null {
	if (!effort || effort === 'off') {
		return effort ?? null;
	}
	return clampEffort(effort, getModelCapabilities(provider, modelId)?.effortOptions);
}

async function resolveVerificationModel(
	projectId: string,
	userId: string,
	models: TestModel[],
): Promise<LlmSelectedModel> {
	return (await getDefaultChatModelForUser(projectId, userId)) ?? toSelectedModel(models[0]);
}

function toSelectedModel(model: TestModel): LlmSelectedModel {
	return {
		provider: model.provider,
		modelId: model.modelId,
		...(model.llmConfigId && { llmConfigId: model.llmConfigId }),
	};
}

/** Invalid files block the run when they are selected, or when the whole suite runs, as with `nao test`. */
function selectInvalidFiles(invalidFiles: InvalidTestFile[], paths: string[] | undefined): InvalidTestFile[] {
	if (!paths?.length) {
		return invalidFiles;
	}
	const selectedPaths = new Set(paths);
	return invalidFiles.filter((file) => selectedPaths.has(file.path));
}

async function resolveFallbackModels(
	input: Pick<StartTestRunInput, 'projectId' | 'userId'>,
): Promise<LlmSelectedModel[]> {
	const defaultModel = await getDefaultChatModelForUser(input.projectId, input.userId);
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

	const abortController = new AbortController();
	liveRuns.set(run.id, abortController);
	const heartbeat = setInterval(() => void recordHeartbeat(run, abortController), TEST_RUN_HEARTBEAT_MS);
	try {
		await mcpService.initializeMcpState(run.projectId);
		await skillService.initializeSkills(run.projectId);
		await runWithConcurrency(jobs, plan.threads, (job) =>
			runAttemptUnlessCancelled(run, userId, job, plan, abortController.signal),
		);
		await testRunQueries.completeRun(run.id);
	} catch (error) {
		await testRunQueries.failRun(run.id, error instanceof Error ? error.message : String(error));
	} finally {
		clearInterval(heartbeat);
		liveRuns.delete(run.id);
	}
}

/**
 * A cancellation handled by another replica only reaches this one through the database, so the heartbeat aborts the
 * attempts in flight once the run is no longer active.
 */
async function recordHeartbeat(run: DBTestRun, abortController: AbortController): Promise<void> {
	try {
		if (!(await testRunQueries.recordHeartbeat(run.id))) {
			abortController.abort();
		}
	} catch (error) {
		logger.error(`Test run ${run.id} heartbeat failed: ${String(error)}`, {
			source: 'agent',
			projectId: run.projectId,
		});
	}
}

function buildAttemptJobs(plan: TestRunPlan): TestAttemptJob[] {
	return plan.tests.flatMap((test) =>
		plan.models.flatMap((model) =>
			Array.from({ length: plan.attempts }, (_, index) => index + 1).flatMap((attempt) =>
				plan.variants.map((variant) => ({ test, model, attempt, variant })),
			),
		),
	);
}

async function runAttemptUnlessCancelled(
	run: DBTestRun,
	userId: string,
	job: TestAttemptJob,
	plan: TestRunPlan,
	abortSignal: AbortSignal,
): Promise<void> {
	if (abortSignal.aborted || (await testRunQueries.getRunStatus(run.id)) !== 'running') {
		return;
	}
	const result = await runAttempt(run, userId, job, plan, abortSignal);
	await testRunQueries.recordResultWhileRunning(result);
}

async function runAttempt(
	run: DBTestRun,
	userId: string,
	job: TestAttemptJob,
	plan: TestRunPlan,
	abortSignal: AbortSignal,
): Promise<NewTestRunResult> {
	const { test, model, attempt, variant } = job;
	const baseResult = {
		runId: run.id,
		testPath: test.path,
		testName: test.name,
		testHash: test.hash,
		tags: test.tags,
		llmProvider: model.provider,
		llmModelId: model.modelId,
		llmConfigId: model.llmConfigId ?? null,
		reasoningEffort: model.reasoningEffort ?? null,
		contextVariant: variant,
		attempt,
	};

	let chatId: string | null = null;
	try {
		const [chat] = await chatQueries.createChat(
			{ title: testChatTitle(test, variant), userId, projectId: run.projectId },
			{ text: test.prompt, source: 'test' },
		);
		chatId = chat.id;

		const [uiChat] = await chatQueries.getChat(chat.id);
		if (!uiChat) {
			throw new Error(`Test chat not found after creation: ${chat.id}`);
		}

		const agentResult = await testAgentService.runTestInChat(
			{ ...uiChat, userId, projectId: run.projectId },
			uiChat.messages,
			model,
			{
				billingAccessVerifiedProjectId: run.projectId,
				abortSignal,
				...(variant === 'draft' && plan.draftFolder && { contextFolder: plan.draftFolder }),
			},
		);
		abortSignal.throwIfAborted();
		const evaluation = await evaluateTestAttempt({
			projectId: run.projectId,
			userId,
			test: { ...test, tolerances: plan.tolerances },
			result: agentResult,
			verificationModel: plan.verificationModel ?? model,
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
			details: buildResultDetails(test, agentResult, evaluation, plan.tolerances),
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { ...baseResult, chatId, passed: false, message: `error: ${errorMessage}`, errorMessage };
	}
}

function testChatTitle(test: TestDefinition, variant: TestContextVariant): string {
	return variant === 'draft' ? `Test: ${test.name} (draft context)` : `Test: ${test.name}`;
}

/** Without the queries the verification read from, such as for a test with no reference SQL, every agent query is kept. */
function buildResultDetails(
	test: TestDefinition,
	agentResult: AgentRunResult,
	evaluation: TestAttemptEvaluation,
	tolerances: TestComparisonTolerances,
): TestRunResultDetails {
	const { verification } = evaluation;
	const columns = verification ? comparedColumns(verification.expectedData, verification.expectedColumns) : [];
	const storedRows = (records: Record<string, unknown>[] | null | undefined) =>
		records ? orderRecordsForComparison(records, columns, tolerances.decimals).slice(0, MAX_STORED_ROWS) : null;
	const verifiedSourceQueries = verification?.sourceQueries ?? [];
	return {
		responseText: agentResult.text,
		actualData: storedRows(verification?.data),
		expectedData: storedRows(verification?.expectedData),
		actualRowCount: verification?.data?.length ?? null,
		expectedRowCount: verification?.expectedData.length ?? null,
		comparison: evaluation.verdict.comparison,
		referenceSql: test.sql,
		verificationSql: evaluation.verification?.sql ?? null,
		sourceQueries:
			verifiedSourceQueries.length > 0 ? verifiedSourceQueries : listAgentQueries(agentResult.queryResults),
	};
}

function listAgentQueries(queryResults: AgentRunResult['queryResults']): TestSourceQuery[] {
	return [...queryResults].flatMap(([id, result]) => (result.sqlQuery ? [{ id, sql: result.sqlQuery }] : []));
}

/**
 * Once a job fails no other job starts, and the failure is thrown only after the jobs in flight settle, so that none
 * of them outlives the run and the context snapshot it reads.
 */
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
	let nextIndex = 0;
	const errors: unknown[] = [];
	const runNext = async (): Promise<void> => {
		while (errors.length === 0 && nextIndex < items.length) {
			const item = items[nextIndex++];
			await worker(item).catch((error: unknown) => {
				errors.push(error);
			});
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
	if (errors.length > 0) {
		throw errors[0];
	}
}

async function getProjectFolder(projectId: string): Promise<string> {
	const project = await projectQueries.getProjectById(projectId);
	if (!project?.path) {
		throw new TestRunInputError('The project has no context folder.');
	}
	return project.path;
}
