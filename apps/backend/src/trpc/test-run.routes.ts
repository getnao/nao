import { TESTS_FOLDER, toTestPath } from '@nao/shared/test-paths';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as testRunQueries from '../queries/test-run.queries';
import {
	type ContextExplorerFileAccess,
	createDraftFile,
	MAX_CONTEXT_FILE_SIZE,
} from '../services/context-explorer.service';
import { createSafeFileAccess, createStrictFileAccess } from '../services/context-explorer-access.service';
import { type DraftSource, hasContextWorktree, readGitDraft } from '../services/draft-context.service';
import { hasContextRepository, readNaoDraft } from '../services/nao-draft.service';
import {
	getLatestOutcomesByTest,
	getModelStats,
	getPreviousModelSummaries,
	getTestHistory,
	listRunsWithTestTotals,
} from '../services/test-history.service';
import {
	cancelTestRun,
	failStaleTestRuns,
	listDefaultReasoningEfforts,
	startChangesRun,
	startComparisonRun,
	startTestRun,
	TestRunConflictError,
	TestRunInputError,
} from '../services/test-runner.service';
import {
	discoverTests,
	isInvalidTestFile,
	newTestFilePaths,
	parseTestContent,
	serializeTestFile,
} from '../services/test-suite.service';
import { activeEffortSchema, llmSelectedModelSchema } from '../types/llm';
import {
	DEFAULT_TEST_COMPARISON_TOLERANCES,
	MAX_TEST_RUN_ATTEMPTS,
	MAX_TEST_RUN_MODELS,
	MAX_TEST_RUN_THREADS,
	type TestComparisonTolerances,
} from '../types/test-run';
import { extractConfiguredTestSettings } from '../utils/nao-config';
import { compareContextVariants } from '../utils/test-comparison';
import { summarizeModels } from '../utils/test-model-summary';
import { draftOwnerOf, requireProjectPath } from './route-context';
import { cloudBillingContextAdminProcedure, contextAdminProtectedProcedure } from './trpc';

const NO_DRAFT_MESSAGE = 'Edit context files in the File Explorer to compare your changes with production.';
const NOT_A_TEST_FILE_MESSAGE = `Tests are YAML files in the ${TESTS_FOLDER}/ folder.`;

interface TestRunRouteContext {
	project: { id: string };
	user: { id: string; name: string; email: string };
}

const draftTestFileSchema = z.object({
	path: z.string(),
	content: z.string().refine((content) => Buffer.byteLength(content, 'utf8') <= MAX_CONTEXT_FILE_SIZE, {
		message: `The test file must be at most ${MAX_CONTEXT_FILE_SIZE} bytes.`,
	}),
});

/**
 * `production` runs against the production context, `changes` against it with the user's changes, and `compare`
 * against both side by side. The target is a test being edited, run as it is in the editor, or saved tests, the
 * whole suite when `paths` is omitted.
 */
const startRunSchema = z.object({
	mode: z.enum(['production', 'changes', 'compare']),
	target: z.union([
		z.object({ testFile: draftTestFileSchema }),
		z.object({ paths: z.array(z.string()).optional() }).strict(),
	]),
	models: z
		.array(llmSelectedModelSchema.extend({ reasoningEfforts: z.array(activeEffortSchema).optional() }))
		.max(MAX_TEST_RUN_MODELS)
		.optional(),
	attempts: z.number().int().min(1).max(MAX_TEST_RUN_ATTEMPTS).optional(),
	threads: z.number().int().min(1).max(MAX_TEST_RUN_THREADS).optional(),
});

export const testRunRoutes = {
	listTests: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const projectFolder = requireProjectPath(ctx.project.path);
		const suite = discoverTests(projectFolder);
		return {
			...suite,
			settings: extractConfiguredTestSettings(projectFolder),
			latestOutcomes: await getLatestOutcomesByTest(ctx.project.id, suite.tests),
		};
	}),

	startRun: cloudBillingContextAdminProcedure.input(startRunSchema).mutation(async ({ ctx, input }) => {
		const { mode, target, ...settings } = input;
		const runInput = { ...settings, ...parseRunTarget(target), projectId: ctx.project.id, userId: ctx.user.id };
		const draft = mode === 'production' ? null : await requireUserDraft(ctx);
		try {
			if (!draft) {
				return await startTestRun(runInput);
			}
			const startDraftContextRun = mode === 'compare' ? startComparisonRun : startChangesRun;
			return await startDraftContextRun({ ...runInput, draft });
		} catch (error) {
			throw toTestRunTrpcError(error);
		}
	}),

	getDraftContext: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const projectFolder = requireProjectPath(ctx.project.path);
		try {
			const draft = await readUserDraft(ctx, projectFolder, createSafeFileAccess);
			if ('message' in draft) {
				return { status: 'unavailable' as const, message: draft.message };
			}
			return { status: 'available' as const, ...draft.context };
		} catch {
			return { status: 'unavailable' as const, message: 'Your context changes could not be read.' };
		}
	}),

	listRuns: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		await failStaleTestRuns(ctx.project.id);
		return listRunsWithTestTotals(ctx.project.id);
	}),

	getRun: contextAdminProtectedProcedure.input(z.object({ runId: z.string() })).query(async ({ ctx, input }) => {
		const run = await getProjectRun(ctx.project.id, input.runId);
		const results = await testRunQueries.listResultOutcomes(run.id);
		return {
			...run,
			results,
			comparison:
				run.trigger === 'comparison' ? compareContextVariants(results, run.models.length * run.attempts) : null,
			modelSummaries: summarizeModels(results),
			previousModelSummaries: await getPreviousModelSummaries(run, results),
		};
	}),

	getModelStats: contextAdminProtectedProcedure.query(({ ctx }) => getModelStats(ctx.project.id)),

	getDefaultReasoningEfforts: contextAdminProtectedProcedure.query(({ ctx }) =>
		listDefaultReasoningEfforts(ctx.project.id),
	),

	getTestHistory: contextAdminProtectedProcedure
		.input(z.object({ path: z.string(), runId: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const testPath = toTestPath(input.path);
			if (!testPath) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: NOT_A_TEST_FILE_MESSAGE });
			}
			return getTestHistory(ctx.project.id, testPath, projectTolerances(ctx.project.path), input.runId);
		}),

	validateTestFile: contextAdminProtectedProcedure.input(draftTestFileSchema).mutation(({ input }) => {
		const parsed = parseDraftTest(input);
		return isInvalidTestFile(parsed) ? { test: null, error: parsed.error } : { test: parsed, error: null };
	}),

	createTestFile: cloudBillingContextAdminProcedure
		.input(
			z.object({
				name: z.string().trim().min(1).max(200),
				prompt: z.string().trim().min(1).max(10_000),
				sql: z.string().trim().max(100_000).optional(),
				databaseId: z.string().trim().min(1).optional(),
				tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const access = await createStrictFileAccess(ctx.project.id, ctx.project.path, ctx.user);
			const content = serializeTestFile({ ...input, owner: ctx.user.email });
			return { path: await createFirstFreeTestFile(newTestFilePaths(input.name), content, access) };
		}),

	cancelRun: contextAdminProtectedProcedure
		.input(z.object({ runId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const run = await getProjectRun(ctx.project.id, input.runId);
			return { cancelled: await cancelTestRun(run) };
		}),
};

function parseRunTarget(target: z.infer<typeof startRunSchema>['target']) {
	return 'testFile' in target ? { tests: [parseValidDraftTest(target.testFile)] } : { paths: target.paths };
}

async function requireUserDraft(ctx: TestRunRouteContext & { project: { path: string | null } }): Promise<DraftSource> {
	const projectFolder = requireProjectPath(ctx.project.path);
	const draft = await readUserDraft(ctx, projectFolder, createStrictFileAccess);
	if ('message' in draft) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: draft.message });
	}
	return draft;
}

/** Without a context repository nao keeps the draft, otherwise it is the user's File Explorer worktree. */
async function readUserDraft(
	ctx: TestRunRouteContext,
	projectFolder: string,
	createFileAccess: typeof createSafeFileAccess,
): Promise<DraftSource | { message: string }> {
	if (!(await hasContextRepository(ctx.project.id))) {
		return readNaoDraft(draftOwnerOf(ctx), projectFolder);
	}
	if (!hasContextWorktree(ctx.project.id, projectFolder, ctx.user.id)) {
		return { message: NO_DRAFT_MESSAGE };
	}
	const access = await createFileAccess(ctx.project.id, projectFolder, ctx.user);
	if (access.git.status === 'unavailable') {
		return { message: access.git.message };
	}
	return readGitDraft(access.git.repo, projectFolder);
}

function parseDraftTest(testFile: z.infer<typeof draftTestFileSchema>) {
	const testPath = toTestPath(testFile.path);
	if (!testPath) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: NOT_A_TEST_FILE_MESSAGE });
	}
	return parseTestContent(testPath, testFile.content);
}

function parseValidDraftTest(testFile: z.infer<typeof draftTestFileSchema>) {
	const parsed = parseDraftTest(testFile);
	if (isInvalidTestFile(parsed)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.error });
	}
	return parsed;
}

/** Diffs use the tolerances the project configures now, as runs do not record theirs. */
function projectTolerances(projectFolder: string | null): TestComparisonTolerances {
	return projectFolder ? extractConfiguredTestSettings(projectFolder).tolerances : DEFAULT_TEST_COMPARISON_TOLERANCES;
}

async function createFirstFreeTestFile(
	candidatePaths: string[],
	content: string,
	access: ContextExplorerFileAccess,
): Promise<string> {
	for (const candidatePath of candidatePaths) {
		try {
			await createDraftFile(candidatePath, content, access);
			return candidatePath;
		} catch (error) {
			if (!(error instanceof TRPCError && error.code === 'CONFLICT')) {
				throw error;
			}
		}
	}
	throw new TRPCError({ code: 'CONFLICT', message: 'A test with this name already exists. Pick another name.' });
}

async function getProjectRun(projectId: string, runId: string) {
	const run = await testRunQueries.getRun(projectId, runId);
	if (!run) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Test run not found: ${runId}` });
	}
	return run;
}

function toTestRunTrpcError(error: unknown): TRPCError {
	if (error instanceof TestRunConflictError) {
		return new TRPCError({ code: 'CONFLICT', message: error.message });
	}
	if (error instanceof TestRunInputError) {
		return new TRPCError({ code: 'BAD_REQUEST', message: error.message });
	}
	return new TRPCError({
		code: 'INTERNAL_SERVER_ERROR',
		message: error instanceof Error ? error.message : 'Failed to start the test run',
	});
}
