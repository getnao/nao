import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as testRunQueries from '../queries/test-run.queries';
import { cancelTestRun, startTestRun, TestRunConflictError, TestRunInputError } from '../services/test-runner.service';
import { discoverTests } from '../services/test-suite.service';
import { llmSelectedModelSchema } from '../types/llm';
import { MAX_TEST_RUN_ATTEMPTS, MAX_TEST_RUN_MODELS } from '../types/test-run';
import { extractConfiguredTestSettings } from '../utils/nao-config';
import { cloudBillingContextAdminProcedure, contextAdminProtectedProcedure } from './trpc';

export const testRunRoutes = {
	listTests: contextAdminProtectedProcedure.query(({ ctx }) => {
		const projectFolder = requireProjectFolder(ctx.project.path);
		return { ...discoverTests(projectFolder), settings: extractConfiguredTestSettings(projectFolder) };
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

	cancelRun: contextAdminProtectedProcedure
		.input(z.object({ runId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const run = await getProjectRun(ctx.project.id, input.runId);
			return { cancelled: await cancelTestRun(run) };
		}),
};

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
