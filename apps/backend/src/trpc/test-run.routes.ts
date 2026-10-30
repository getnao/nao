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
import { getLatestOutcomesByTest, listRunsWithVariantTotals } from '../services/test-history.service';
import {
	cancelTestRun,
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
	toTestPath,
} from '../services/test-suite.service';
import { llmSelectedModelSchema } from '../types/llm';
import { MAX_TEST_RUN_ATTEMPTS, MAX_TEST_RUN_MODELS } from '../types/test-run';
import { extractConfiguredTestSettings } from '../utils/nao-config';
import { compareContextVariants } from '../utils/test-comparison';
import { cloudBillingContextAdminProcedure, contextAdminProtectedProcedure } from './trpc';

const NO_DRAFT_MESSAGE = 'Edit context files in the File Explorer to compare your changes with production.';

interface TestRunRouteContext {
	project: { id: string };
	user: { id: string; name: string; email: string };
}

const runSelectionSchema = z.object({
	paths: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	models: z.array(llmSelectedModelSchema).max(MAX_TEST_RUN_MODELS).optional(),
	attempts: z.number().int().min(1).max(MAX_TEST_RUN_ATTEMPTS).optional(),
});

const draftTestFileSchema = z.object({
	path: z.string(),
	content: z.string().refine((content) => Buffer.byteLength(content, 'utf8') <= MAX_CONTEXT_FILE_SIZE, {
		message: `The test file must be at most ${MAX_CONTEXT_FILE_SIZE} bytes.`,
	}),
});

export const testRunRoutes = {
	listTests: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const projectFolder = requireProjectFolder(ctx.project.path);
		const suite = discoverTests(projectFolder);
		return {
			...suite,
			settings: extractConfiguredTestSettings(projectFolder),
			latestOutcomes: await getLatestOutcomesByTest(ctx.project.id, suite.tests),
		};
	}),

	startRun: cloudBillingContextAdminProcedure.input(runSelectionSchema).mutation(async ({ ctx, input }) => {
		try {
			return await startTestRun({ ...input, projectId: ctx.project.id, userId: ctx.user.id });
		} catch (error) {
			throw toTestRunTrpcError(error);
		}
	}),

	getDraftContext: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const projectFolder = requireProjectFolder(ctx.project.path);
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

	startComparisonRun: cloudBillingContextAdminProcedure.input(runSelectionSchema).mutation(async ({ ctx, input }) => {
		const projectFolder = requireProjectFolder(ctx.project.path);
		const draft = await readUserDraft(ctx, projectFolder, createStrictFileAccess);
		if ('message' in draft) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: draft.message });
		}
		try {
			return await startComparisonRun({ ...input, projectId: ctx.project.id, userId: ctx.user.id, draft });
		} catch (error) {
			throw toTestRunTrpcError(error);
		}
	}),

	listRuns: contextAdminProtectedProcedure.query(({ ctx }) => listRunsWithVariantTotals(ctx.project.id)),

	getRun: contextAdminProtectedProcedure.input(z.object({ runId: z.string() })).query(async ({ ctx, input }) => {
		const run = await getProjectRun(ctx.project.id, input.runId);
		const results = await testRunQueries.listResults(run.id);
		return {
			...run,
			results,
			comparison:
				run.trigger === 'comparison' ? compareContextVariants(results, run.models.length * run.attempts) : null,
		};
	}),

	validateTestFile: contextAdminProtectedProcedure.input(draftTestFileSchema).mutation(({ input }) => {
		const parsed = parseDraftTest(input.path, input.content);
		return isInvalidTestFile(parsed) ? { test: null, error: parsed.error } : { test: parsed, error: null };
	}),

	startDraftRun: cloudBillingContextAdminProcedure.input(draftTestFileSchema).mutation(async ({ ctx, input }) => {
		const parsed = parseDraftTest(input.path, input.content);
		if (isInvalidTestFile(parsed)) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.error });
		}
		try {
			return await startTestRun({ projectId: ctx.project.id, userId: ctx.user.id, tests: [parsed] });
		} catch (error) {
			throw toTestRunTrpcError(error);
		}
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

/** Without a context repository nao keeps the draft, otherwise it is the user's File Explorer worktree. */
async function readUserDraft(
	ctx: TestRunRouteContext,
	projectFolder: string,
	createFileAccess: typeof createSafeFileAccess,
): Promise<DraftSource | { message: string }> {
	if (!(await hasContextRepository(ctx.project.id))) {
		return readNaoDraft({ projectId: ctx.project.id, userId: ctx.user.id }, projectFolder);
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

function parseDraftTest(projectPath: string, content: string) {
	const testPath = toTestPath(projectPath);
	if (!testPath) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tests are YAML files in the tests/ folder.' });
	}
	return parseTestContent(testPath, content);
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

function requireProjectFolder(projectFolder: string | null): string {
	if (!projectFolder) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The project has no context folder.' });
	}
	return projectFolder;
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
