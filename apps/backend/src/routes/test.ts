import { z } from 'zod/v4';

import { executeQuery } from '../agents/tools/execute-sql';
import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import { ModelSelection } from '../services/agent.service';
import { TestAgentService, testAgentService } from '../services/test-agent.service';
import { llmProviderSchema } from '../types/llm';
import { retrieveProjectById } from '../utils/chat';

const modelSelectionSchema = z.object({
	provider: llmProviderSchema,
	modelId: z.string(),
});

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
					model: modelSelectionSchema,
					sql: z.string(),
				}),
			},
		},
		async (request, reply) => {
			const projectId = request.project?.id;
			const { prompt, model, sql } = request.body;

			if (!projectId) {
				return reply
					.status(400)
					.send({ error: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.' });
			}

			try {
				const modelSelection = model as ModelSelection | undefined;
				const result = await testAgentService.runTest(projectId, prompt, modelSelection);
				const project = await retrieveProjectById(projectId);

				let verification;
				if (sql) {
					const { data: expectedData, columns: expectedColumns } = await executeQuery(
						{ sql_query: sql },
						{ projectFolder: project.path! },
					);
					const { data } = await testAgentService.runVerification(
						projectId,
						result,
						expectedColumns,
						modelSelection,
					);
					verification = { data, expectedData, expectedColumns };
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
				const message = err instanceof Error ? err.message : 'Unknown error';
				return reply.status(500).send({ error: message });
			}
		},
	);
};
