import type { LlmSelectedModel } from '@nao/shared/types';
import { NoObjectGeneratedError } from 'ai';
import { z } from 'zod/v4';

import { executeQuery } from '../agents/tools/execute-sql';
import type { App } from '../app';
import { noProjectMessage } from '../env';
import { authMiddleware } from '../middleware/auth';
import { retrieveProjectById } from '../queries/project.queries';
import { TestAgentService, testAgentService } from '../services/test-agent.service';
import { customModelCostSchema, llmSelectedModelSchema } from '../types/llm';
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
	app.addHook('preHandler', authMiddleware);

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
					model: llmSelectedModelSchema,
					sql: z.string(),
					databaseId: z.string().optional(),
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
			const { prompt, model, sql, databaseId, meta } = request.body;

			const costs = meta?.costs;

			if (!projectId) {
				return reply.status(400).send({ error: noProjectMessage() });
			}

			try {
				const modelSelection = model as LlmSelectedModel | undefined;
				const result = await testAgentService.runTest(projectId, prompt, modelSelection, costs);
				const project = await retrieveProjectById(projectId);

				let verification;
				if (sql) {
					const { data: expectedData, columns: expectedColumns } = await executeQuery(
						{ sql_query: sql, database_id: databaseId },
						{
							projectFolder: project.path!,
							chatId: '',
							userId,
							projectId: projectId,
							supportsCustomCharts: false,
							agentSettings: null,
							envVars: {},
							azureAccessToken: null,
							queryResults: new Map(),
							generatedArtifacts: { charts: [], maps: [], stories: [] },
						},
					);
					const verified = await testAgentService.runVerification(
						projectId,
						result,
						expectedColumns,
						modelSelection,
					);
					verification = { ...verified, expectedData, expectedColumns };
				}

				return reply.send({
					text: result.text,
					toolCalls: TestAgentService.extractToolCalls(result),
					usage: result.usage,
					cost: result.cost,
					finishReason: result.finishReason,
					durationMs: result.durationMs,
					verification,
				});
			} catch (err) {
				return reply.status(500).send({ error: describeRunError(err) });
			}
		},
	);
};
