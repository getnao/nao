import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DBTestRun } from '../../db/abstractSchema';
import * as projectQueries from '../../queries/project.queries';
import * as testRunQueries from '../../queries/test-run.queries';
import * as userQueries from '../../queries/user.queries';
import { getLatestOutcomesByTest, listRunsWithTestTotals } from '../../services/test-history.service';
import { startRunInMode, type TestRunMode } from '../../services/test-run-start.service';
import { cancelTestRun, failStaleTestRuns } from '../../services/test-runner.service';
import { discoverTests } from '../../services/test-suite.service';
import { MAX_TEST_RUN_ATTEMPTS, TEST_RUN_STATUSES, TEST_RUN_TRIGGERS } from '../../types/test-run';
import { compareContextVariants, listOneSidedTests } from '../../utils/test-comparison';
import { countAttemptsByTest, toAttemptCounts } from '../../utils/test-run-totals';
import type { McpContext } from '../logging';
import { errorMessageOf, jsonToolResult, registerMcpTool } from './register-mcp-tool';

const TEST_RUN_MODES = ['production', 'changes', 'compare'] as const satisfies readonly TestRunMode[];

const LIST_TESTS_DESCRIPTION =
	'List the tests of this nao project: the questions in its `tests/` folder, each with the answer nao must give ' +
	'(admins and context admins only).\n\n' +
	'USE WHEN: you want to know which tests exist, how they last did, or pick the ones to run with `run_tests`.\n' +
	'Returns each test with its latest completed outcome, and the test files that cannot be read.';

const RUN_TESTS_DESCRIPTION =
	'Start a run of the project tests (admins and context admins only).\n\n' +
	'`production` asks each test against the production context. `compare` asks it against production and with ' +
	'the changes side by side, `changes` with the changes only. The changes are those of `upstream`, a branch of a ' +
	'repository synced into the context, or else your File Explorer changes in nao. Tests the changes add only run ' +
	'with the changes.\n' +
	'The run goes on in the background, one at a time per project: poll `get_test_run` with the returned `runId`.';

const LIST_TEST_RUNS_DESCRIPTION =
	'List the latest test runs of this nao project, newest first, with how many tests passed on each side ' +
	'(admins and context admins only).';

const GET_TEST_RUN_DESCRIPTION =
	'Fetch a test run: its status and progress, and each test with its passed attempts and first failure ' +
	'(admins and context admins only).\n\n' +
	'For a `comparison` run, each test also says how the changes moved it: `regressed`, `worsened`, `fixed`, ' +
	'`improved`, `new` (only on the changes), `removed` (deleted by the changes), `unchanged`, or `pending` while it runs.';

const CANCEL_TEST_RUN_DESCRIPTION =
	'Cancel a queued or running test run of this nao project (admins and context admins only).';

const RUN_ID_INPUT = z.string().describe('Test run id, from `run_tests.runId` or `list_test_runs.runs[].id`.');

const ATTEMPT_COUNTS_SCHEMA = z.object({ passedAttempts: z.number(), totalAttempts: z.number() });

const RUN_SUMMARY_SCHEMA = z.object({
	id: z.string(),
	status: z.enum(TEST_RUN_STATUSES),
	trigger: z
		.enum(TEST_RUN_TRIGGERS)
		.describe(
			'`manual` on production, `draft` for tests as edited, `changes` with the changes, `comparison` both.',
		),
	contextRef: z.string().nullable().describe('Branch the changes come from, when the run tested changes.'),
	selection: z.array(z.string()).describe('Paths of the tests the run covers, relative to `tests/`.'),
	completedAttempts: z.number(),
	totalAttempts: z.number(),
	errorMessage: z.string().nullable(),
	createdAt: z.string(),
});

export function registerTestTools(server: McpServer, ctx: McpContext): void {
	registerListTests(server, ctx);
	registerRunTests(server, ctx);
	registerListTestRuns(server, ctx);
	registerGetTestRun(server, ctx);
	registerCancelTestRun(server, ctx);
}

function registerListTests(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'list_tests',
		title: 'List Tests',
		description: LIST_TESTS_DESCRIPTION,
		inputSchema: {},
		outputSchema: {
			tests: z.array(
				z.object({
					path: z.string().describe('Path relative to `tests/`, to pass to `run_tests.paths`.'),
					name: z.string(),
					prompt: z.string(),
					tags: z.array(z.string()),
					owner: z.string().nullable(),
					hasReferenceSql: z.boolean(),
					latestOutcome: ATTEMPT_COUNTS_SCHEMA.extend({
						runId: z.string(),
						isOutdated: z.boolean().describe('The test changed since that run.'),
					}).nullable(),
				}),
			),
			invalidFiles: z.array(z.object({ path: z.string(), error: z.string() })),
		},
		errorMessage: errorMessageOf('list_tests'),
		handler: async () => {
			const suite = discoverTests(await requireProjectFolder(ctx));
			const latestOutcomes = await getLatestOutcomesByTest(ctx.projectId, suite.tests);
			return jsonToolResult({
				tests: suite.tests.map((test) => {
					const outcome = latestOutcomes[test.path];
					return {
						path: test.path,
						name: test.name,
						prompt: test.prompt,
						tags: test.tags,
						owner: test.owner,
						hasReferenceSql: test.sql !== null,
						latestOutcome: outcome
							? {
									runId: outcome.runId,
									passedAttempts: outcome.passedAttempts,
									totalAttempts: outcome.totalAttempts,
									isOutdated: outcome.isOutdated,
								}
							: null,
					};
				}),
				invalidFiles: suite.invalidFiles,
			});
		},
	});
}

function registerRunTests(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'run_tests',
		title: 'Run Tests',
		description: RUN_TESTS_DESCRIPTION,
		inputSchema: {
			mode: z.enum(TEST_RUN_MODES).default('production'),
			paths: z
				.array(z.string())
				.optional()
				.describe('Tests to run, from `list_tests.tests[].path`. Omit to run the whole suite.'),
			tags: z.array(z.string()).optional().describe('Only the tests with one of these tags.'),
			attempts: z
				.number()
				.int()
				.min(1)
				.max(MAX_TEST_RUN_ATTEMPTS)
				.optional()
				.describe('How many times to ask each test. Defaults to the project test settings.'),
			upstream: z
				.object({ repo: z.string().min(1), branch: z.string().min(1) })
				.optional()
				.describe('Branch of a repository synced into the context whose changes to test.'),
		},
		outputSchema: { runId: z.string(), run: RUN_SUMMARY_SCHEMA },
		errorMessage: errorMessageOf('run_tests'),
		handler: async ({ mode, paths, tags, attempts, upstream }) => {
			const run = await startRunInMode({
				mode,
				run: { projectId: ctx.projectId, userId: ctx.userId, paths, tags, attempts },
				upstream,
				reader: {
					projectId: ctx.projectId,
					projectFolder: await requireProjectFolder(ctx),
					user: await requireUser(ctx),
				},
			});
			return jsonToolResult({ runId: run.id, run: toRunSummary(run) });
		},
	});
}

function registerListTestRuns(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'list_test_runs',
		title: 'List Test Runs',
		description: LIST_TEST_RUNS_DESCRIPTION,
		inputSchema: {},
		outputSchema: {
			runs: z.array(
				RUN_SUMMARY_SCHEMA.extend({
					triggeredBy: z.string().nullable(),
					variants: z.array(
						z.object({
							contextVariant: z.enum(['production', 'draft']),
							testCount: z.number(),
							passedTests: z.number(),
						}),
					),
				}),
			),
		},
		errorMessage: errorMessageOf('list_test_runs'),
		handler: async () => {
			await failStaleTestRuns(ctx.projectId);
			const runs = await listRunsWithTestTotals(ctx.projectId);
			return jsonToolResult({
				runs: runs.map((run) => ({
					...toRunSummary(run),
					triggeredBy: run.triggeredByName,
					variants: run.testTotals.map(({ contextVariant, testCount, passedTests }) => ({
						contextVariant,
						testCount,
						passedTests,
					})),
				})),
			});
		},
	});
}

function registerGetTestRun(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'get_test_run',
		title: 'Get Test Run',
		description: GET_TEST_RUN_DESCRIPTION,
		inputSchema: { run_id: RUN_ID_INPUT },
		outputSchema: {
			run: RUN_SUMMARY_SCHEMA,
			tests: z.array(
				ATTEMPT_COUNTS_SCHEMA.extend({
					testPath: z.string(),
					testName: z.string(),
					firstFailure: z.string().nullable(),
				}),
			),
			comparison: z
				.object({
					production: ATTEMPT_COUNTS_SCHEMA.describe('Over the tests both sides ran.'),
					changes: ATTEMPT_COUNTS_SCHEMA.describe('Over the tests both sides ran, without the `new` ones.'),
					tests: z.array(
						z.object({
							testPath: z.string(),
							production: ATTEMPT_COUNTS_SCHEMA,
							changes: ATTEMPT_COUNTS_SCHEMA,
							change: z.string(),
						}),
					),
				})
				.nullable()
				.describe('How the changes moved each test, for a `comparison` run.'),
		},
		errorMessage: errorMessageOf('get_test_run'),
		handler: async ({ run_id }) => {
			await failStaleTestRuns(ctx.projectId);
			const run = await requireRun(ctx, run_id);
			const results = await testRunQueries.listResultOutcomes(run.id);
			return jsonToolResult({
				run: toRunSummary(run),
				tests: summarizeTests(results),
				comparison: run.trigger === 'comparison' ? summarizeComparison(run, results) : null,
			});
		},
	});
}

function registerCancelTestRun(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'cancel_test_run',
		title: 'Cancel Test Run',
		description: CANCEL_TEST_RUN_DESCRIPTION,
		inputSchema: { run_id: RUN_ID_INPUT },
		outputSchema: { cancelled: z.boolean().describe('False when the run had already finished.') },
		errorMessage: errorMessageOf('cancel_test_run'),
		handler: async ({ run_id }) => {
			const run = await requireRun(ctx, run_id);
			return jsonToolResult({ cancelled: await cancelTestRun(run) });
		},
	});
}

type RunResult = Awaited<ReturnType<typeof testRunQueries.listResultOutcomes>>[number];

function summarizeTests(results: RunResult[]) {
	const countsByTest = countAttemptsByTest(results.map(toAttemptCounts));
	return [...countsByTest].map(([testPath, counts]) => {
		const testResults = results.filter((result) => result.testPath === testPath);
		const failure = testResults.find((result) => !result.passed);
		return {
			testPath,
			testName: testResults[0]?.testName ?? testPath,
			...counts,
			firstFailure: failure ? (failure.errorMessage ?? failure.message) : null,
		};
	});
}

function summarizeComparison(run: DBTestRun, results: RunResult[]) {
	const comparison = compareContextVariants(
		results,
		run.models.length * run.attempts,
		listOneSidedTests(run.contextChanges),
	);
	return {
		production: comparison.production,
		changes: comparison.draft,
		tests: comparison.tests.map((test) => ({
			testPath: test.testPath,
			production: test.production,
			changes: test.draft,
			change: test.change,
		})),
	};
}

function toRunSummary(run: DBTestRun): z.infer<typeof RUN_SUMMARY_SCHEMA> {
	return {
		id: run.id,
		status: run.status,
		trigger: run.trigger,
		contextRef: run.contextRef,
		selection: run.selection ?? [],
		completedAttempts: run.completedAttempts,
		totalAttempts: run.totalAttempts,
		errorMessage: run.errorMessage,
		createdAt: run.createdAt.toISOString(),
	};
}

async function requireRun(ctx: McpContext, runId: string): Promise<DBTestRun> {
	const run = await testRunQueries.getRun(ctx.projectId, runId);
	if (!run) {
		throw new Error(`Test run ${runId} not found in this project.`);
	}
	return run;
}

async function requireProjectFolder(ctx: McpContext): Promise<string> {
	const project = await projectQueries.getProjectById(ctx.projectId);
	if (!project?.path) {
		throw new Error('The project has no context folder.');
	}
	return project.path;
}

async function requireUser(ctx: McpContext): Promise<{ id: string; name: string; email: string }> {
	const user = await userQueries.getUser({ id: ctx.userId });
	if (!user) {
		throw new Error('Your nao account could not be found.');
	}
	return { id: user.id, name: user.name, email: user.email };
}
