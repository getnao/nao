import { story } from '@nao/shared/tools';
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, ToolLoopAgent } from 'ai';
import { z } from 'zod/v4';

import { getDefaultModelId } from '../agents/providers';
import { getTools } from '../agents/tools';
import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as projectQueries from '../queries/project.queries';
import { llmProviderSchema } from '../types/llm';
import type { ToolContext } from '../types/tools';
import { HandlerError } from '../utils/error';
import { resolveFirstProjectProvider, resolveProviderModel } from '../utils/llm';

const mentionSchema = z.object({ id: z.string(), label: z.string(), trigger: z.string() });

const bodySchema = z.object({
	messages: z.array(z.unknown()),
	systemContext: z.string().max(100_000),
	model: z.object({ provider: llmProviderSchema, modelId: z.string() }).optional(),
	mentions: z.array(mentionSchema).optional(),
});

const STORY_MODE_INSTRUCTION =
	'[Story mode: present your response as an interactive nao Story using the story tool, combining markdown and charts]';

export const askSelectionRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: bodySchema } }, async ({ project, body }) => {
		const projectId = project?.id;
		if (!projectId) {
			throw new HandlerError(
				'BAD_REQUEST',
				'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.',
			);
		}

		const defaultProvider = await resolveFirstProjectProvider(projectId);
		const provider = body.model?.provider ?? defaultProvider;
		if (!provider) {
			throw new HandlerError('BAD_REQUEST', 'No LLM provider configured.');
		}

		const modelId = body.model?.modelId ?? getDefaultModelId(provider);
		const modelConfig = await resolveProviderModel(projectId, provider, modelId);
		if (!modelConfig) {
			throw new HandlerError('BAD_REQUEST', 'Could not resolve model configuration.');
		}

		const projectData = await projectQueries.retrieveProjectById(projectId);
		if (!projectData.path) {
			throw new HandlerError('BAD_REQUEST', 'Project path does not exist.');
		}

		const agentSettings = await projectQueries.getAgentSettings(projectId);
		const tools = getTools(agentSettings);

		const toolContext: ToolContext = {
			projectFolder: projectData.path,
			chatId: crypto.randomUUID(),
			agentSettings,
			queryResults: new Map(),
		};

		const isStoryMode = body.mentions?.some((m) => m.id === story.MENTION_ID) ?? false;
		const systemPrompt = isStoryMode ? `${body.systemContext}\n\n${STORY_MODE_INSTRUCTION}` : body.systemContext;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const modelMessages = await convertToModelMessages(body.messages as any[], { tools });

		const agent = new ToolLoopAgent({
			model: modelConfig.model,
			providerOptions: modelConfig.providerOptions,
			tools,
			maxOutputTokens: 2048,
			experimental_context: toolContext,
		});

		const result = await agent.stream({
			messages: [{ role: 'system', content: systemPrompt }, ...modelMessages],
		});

		const uiStream = createUIMessageStream({
			execute: ({ writer }) => {
				writer.merge(result.toUIMessageStream({ sendStart: false }));
			},
		});

		return createUIMessageStreamResponse({ stream: uiStream });
	});
};
