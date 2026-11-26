import { NoObjectGeneratedError } from 'ai';
import { z } from 'zod/v4';

import { getModelReasoningEfforts } from '../agents/provider-meta';
import type { App } from '../app';
import { noProjectMessage } from '../env';
import { sessionOrApiKeyAuthMiddleware } from '../middleware/auth';
import { getUserRoleInProject } from '../queries/project.queries';
import { testAgentService } from '../services/test-agent.service';
import { evaluateTestAttempt, type TestAttemptEvaluation } from '../services/test-evaluation.service';
import { activeEffortSchema, customModelCostSchema, llmSelectedModelSchema } from '../types/llm';
import { testAssertionSchema, testComparisonTolerancesSchema, type TestModel } from '../types/test-run';
import { truncateMiddle } from '../utils/utils';

const describeRunError = (err: unknown): string => {
	if (!NoObjectGeneratedError.isInstance(err)) {
		return err instanceof Error ? err.message : 'Unknown error';
	}

	const details = [
		`finishReason=${err.finishReason ?? 'unknown'}`,
		`outputTokens=${err.usage?.outputTokens ?? 'unknown'}`,
		`text=${JSON.stringify(truncateMiddle(err.text ?? '', 500))}`,
	].join(', ');

	return `${err.message} (${details})`;
};

export const testRoutes = async (app: App) => {
	app.addHook('preHandler', sessionOrApiKeyAuthMiddleware);

	/**
	 * Run a single prompt without persisting to a chat.
	 * Used for testing/evaluation purposes from the CLI.
	 */
	app.post(
		'/run',
		{
			schema: {
				body: z.object({
					prompt: z.string(),
					model: llmSelectedModelSchema.extend({ reasoningEffort: activeEffortSchema.optional() }),
					sql: z.string().optional(),
					databaseId: z.string().optional(),
					assertions: z.array(testAssertionSchema).default([]),
					comparison: testComparisonTolerancesSchema.optional(),
					meta: z
						.object({
							costs: customModelCostSchema,
						})
						.optional(),
				}),
			},
		},
		async (request, reply) => {
			const projectId = request.project?.id;
			const userId = request.user.id;
			const { prompt, model, sql, databaseId, assertions, comparison, meta } = request.body;

			const costs = meta?.costs;

			if (!projectId) {
				return reply.status(400).send({ error: noProjectMessage() });
			}
			const userRole = await getUserRoleInProject(projectId, userId);
			if (!userRole || userRole === 'viewer') {
				return reply.status(403).send({ error: 'Viewers cannot run tests' });
			}
			const unsupportedEffortError = describeUnsupportedEffort(model);
			if (unsupportedEffortError) {
				return reply.status(400).send({ error: unsupportedEffortError });
			}

			try {
				const result = await testAgentService.runTest(projectId, userId, prompt, model, costs);
				const { toolCalls, verification, verdict } = await evaluateTestAttempt({
					projectId,
					userId,
					test: { prompt, sql, databaseId, assertions, tolerances: comparison },
					result,
					verificationModel: model,
				});

				return reply.send({
					text: result.text,
					toolCalls,
					usage: result.usage,
					cost: result.cost,
					finishReason: result.finishReason,
					durationMs: result.durationMs,
					verification: verification && toCliVerification(verification),
					verdict,
				});
			} catch (err) {
				return reply.status(500).send({ error: describeRunError(err) });
			}
		},
	);

	/** The reasoning efforts a model can run at, for `nao test` to expand `reasoning_efforts: all` and check the others. */
	app.get('/reasoning-efforts', { schema: { querystring: llmSelectedModelSchema } }, async (request, reply) => {
		const { provider, modelId } = request.query;
		return reply.send({ reasoningEfforts: getModelReasoningEfforts(provider, modelId) });
	});
};

function describeUnsupportedEffort({ provider, modelId, reasoningEffort }: TestModel): string | null {
	const supported = getModelReasoningEfforts(provider, modelId);
	if (!reasoningEffort || supported.includes(reasoningEffort)) {
		return null;
	}
	const expected = supported.length > 0 ? `one of ${supported.join(', ')}` : 'none, as it has no reasoning efforts';
	return `${provider}:${modelId} cannot run at the reasoning effort ${reasoningEffort}, expected ${expected}.`;
}

/** Keeps the verification fields `nao test` knows, as released CLIs reject unknown ones. */
function toCliVerification(verification: NonNullable<TestAttemptEvaluation['verification']>) {
	const { data, expectedData, expectedColumns, sql, error } = verification;
	return { data, expectedData, expectedColumns, sql, error };
}
