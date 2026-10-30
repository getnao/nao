import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as testRunQueries from '../queries/test-run.queries';
import {
	type ContextExplorerFileAccess,
	createDraftFile,
	MAX_CONTEXT_FILE_SIZE,
} from '../services/context-explorer.service';
import { createStrictFileAccess } from '../services/context-explorer-access.service';
import { getLatestOutcomesByTest } from '../services/test-history.service';
import { cancelTestRun, startTestRun, TestRunConflictError, TestRunInputError } from '../services/test-runner.service';
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
import { cloudBillingContextAdminProcedure, contextAdminProtectedProcedure } from './trpc';

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

	startRun: cloudBillingContextAdminProcedure
		.input(
			z.object({
				paths: z.array(z.string()).optional(),
				tags: z.array(z.string()).optional(),
				models: z.array(llmSelectedModelSchema).max(MAX_TEST_RUN_MODELS).optional(),
				attempts: z.number().int().min(1).max(MAX_TEST_RUN_ATTEMPTS).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await startTestRun({ ...input, projectId: ctx.project.id, userId: ctx.user.id });
			} catch (error) {
				throw toTestRunTrpcError(error);
			}
		}),

	listRuns: contextAdminProtectedProcedure.query(({ ctx }) => testRunQueries.listRuns(ctx.project.id)),

	getRun: contextAdminProtectedProcedure.input(z.object({ runId: z.string() })).query(async ({ ctx, input }) => {
		const run = await getProjectRun(ctx.project.id, input.runId);
		return { ...run, results: await testRunQueries.listResults(run.id) };
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
