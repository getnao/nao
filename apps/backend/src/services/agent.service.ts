import { AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI, OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import {
	convertToModelMessages,
	createUIMessageStream,
	StreamTextResult,
	ToolLoopAgent,
	ToolLoopAgentSettings,
} from 'ai';

import { getInstructions } from '../agents/prompt';
import { tools } from '../agents/tools';
import * as chatQueries from '../queries/chat.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { UIChat, UIMessage } from '../types/chat';
import { getDefaultModelId, LlmProvider } from '../types/llm';
import { convertToTokenUsage } from '../utils/chat';

type AgentChat = UIChat & {
	userId: string;
	projectId: string;
};

export type ModelSelection = {
	provider: LlmProvider;
	modelId: string;
};

class AgentService {
	private _agents = new Map<string, AgentManager>();

	async create(
		chat: AgentChat,
		abortController: AbortController,
		modelSelection?: ModelSelection,
	): Promise<AgentManager> {
		this._disposeAgent(chat.id);
		const modelConfig = await this._getModelConfig(chat.projectId, modelSelection);
		const agent = new AgentManager(chat, modelConfig, () => this._agents.delete(chat.id), abortController);
		this._agents.set(chat.id, agent);
		return agent;
	}

	private _disposeAgent(chatId: string): void {
		const agent = this._agents.get(chatId);
		if (!agent) {
			return;
		}
		agent.stop();
		this._agents.delete(chatId);
	}

	get(chatId: string): AgentManager | undefined {
		return this._agents.get(chatId);
	}

	private async _getModelConfig(
		projectId: string,
		modelSelection?: ModelSelection,
	): Promise<Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>> {
		// If a specific model is selected, use it
		if (modelSelection) {
			const config = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, modelSelection.provider);

			if (config) {
				return this._createProviderConfig(
					modelSelection.provider,
					config.apiKey,
					modelSelection.modelId,
					config.baseUrl,
				);
			}

			// No config but env var might exist - check and use default model
			if (modelSelection.provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
				return this._createProviderConfig('anthropic', process.env.ANTHROPIC_API_KEY, modelSelection.modelId);
			}
			if (modelSelection.provider === 'openai' && process.env.OPENAI_API_KEY) {
				return this._createProviderConfig('openai', process.env.OPENAI_API_KEY, modelSelection.modelId);
			}
		}

		// No model selection - use first available config or env
		const configs = await llmConfigQueries.getProjectLlmConfigs(projectId);

		// Prefer anthropic, then openai
		const anthropicConfig = configs.find((c) => c.provider === 'anthropic');
		if (anthropicConfig) {
			const modelId = anthropicConfig.enabledModels?.[0] ?? getDefaultModelId('anthropic');
			return this._createProviderConfig('anthropic', anthropicConfig.apiKey, modelId, anthropicConfig.baseUrl);
		}

		const openaiConfig = configs.find((c) => c.provider === 'openai');
		if (openaiConfig) {
			const modelId = openaiConfig.enabledModels?.[0] ?? getDefaultModelId('openai');
			return this._createProviderConfig('openai', openaiConfig.apiKey, modelId, openaiConfig.baseUrl);
		}

		// Fall back to environment variables (no config at all)
		if (process.env.ANTHROPIC_API_KEY) {
			return this._createProviderConfig('anthropic', process.env.ANTHROPIC_API_KEY, getDefaultModelId('anthropic'));
		}

		if (process.env.OPENAI_API_KEY) {
			return this._createProviderConfig('openai', process.env.OPENAI_API_KEY, getDefaultModelId('openai'));
		}

		throw new Error(
			'No LLM API key found. Configure API keys in project settings or set ANTHROPIC_API_KEY/OPENAI_API_KEY environment variables.',
		);
	}

	private _createProviderConfig(
		provider: LlmProvider,
		apiKey: string,
		modelId: string,
		baseUrl?: string | null,
	): Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'> {
		if (provider === 'anthropic') {
			const anthropic = createAnthropic({
				apiKey,
				...(baseUrl && { baseURL: baseUrl }),
			});
			return {
				model: anthropic.chat(modelId),
				providerOptions: {
					anthropic: {
						disableParallelToolUse: false,
						thinking: {
							type: 'enabled',
							budgetTokens: 12_000,
						},
					} satisfies AnthropicProviderOptions,
				},
			};
		}

		// OpenAI
		const openai = createOpenAI({
			apiKey,
			...(baseUrl && { baseURL: baseUrl }),
		});
		return {
			model: openai.chat(modelId),
			providerOptions: {
				openai: {
					// TODO: Add config for openai
				} satisfies OpenAIResponsesProviderOptions,
			},
		};
	}
}

class AgentManager {
	private readonly _agent: ToolLoopAgent<never, typeof tools, never>;

	constructor(
		readonly chat: AgentChat,
		modelConfig: Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>,
		private readonly _onDispose: () => void,
		private readonly _abortController: AbortController,
	) {
		this._agent = new ToolLoopAgent({
			...modelConfig,
			tools,
			instructions: getInstructions(),
		});
	}

	stream(
		messages: UIMessage[],
		opts: {
			sendNewChatData: boolean;
		},
	): ReadableStream {
		let error: unknown = undefined;
		let result: StreamTextResult<typeof tools, never>;
		return createUIMessageStream<UIMessage>({
			generateId: () => crypto.randomUUID(),
			execute: async ({ writer }) => {
				if (opts.sendNewChatData) {
					writer.write({
						type: 'data-newChat',
						data: {
							id: this.chat.id,
							title: this.chat.title,
							createdAt: this.chat.createdAt,
							updatedAt: this.chat.updatedAt,
						},
					});
				}

				result = await this._agent.stream({
					messages: await convertToModelMessages(messages),
					abortSignal: this._abortController.signal,
				});

				writer.merge(result.toUIMessageStream({}));
			},
			onError: (err) => {
				error = err;
				return String(err);
			},
			onFinish: async (e) => {
				const stopReason = e.isAborted ? 'interrupted' : e.finishReason;
				const tokenUsage = convertToTokenUsage(await result.totalUsage);
				await chatQueries.upsertMessage(e.responseMessage, {
					chatId: this.chat.id,
					stopReason,
					error,
					tokenUsage,
				});
				this._onDispose();
			},
		});
	}

	checkIsUserOwner(userId: string): boolean {
		return this.chat.userId === userId;
	}

	stop(): void {
		this._abortController.abort();
	}
}

// Singleton instance of the agent service
export const agentService = new AgentService();
