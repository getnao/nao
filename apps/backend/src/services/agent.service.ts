import { AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI, GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
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
import { getProviderModelConfig, LlmProvider } from '../types/llm';
import { convertToTokenUsage } from '../utils/chat';
import { getDefaultModelId, getEnvApiKey, getEnvModelSelections, ModelSelection } from '../utils/llm';

export type { ModelSelection };

type AgentChat = UIChat & {
	userId: string;
	projectId: string;
};

class AgentService {
	private _agents = new Map<string, AgentManager>();

	async create(
		chat: AgentChat,
		abortController: AbortController,
		modelSelection?: ModelSelection,
	): Promise<AgentManager> {
		this._disposeAgent(chat.id);
		const resolvedModelSelection = await this._getResolvedModelSelection(chat.projectId, modelSelection);
		const modelConfig = await this._getModelConfig(chat.projectId, resolvedModelSelection);
		const agent = new AgentManager(
			chat,
			modelConfig,
			resolvedModelSelection,
			() => this._agents.delete(chat.id),
			abortController,
		);
		this._agents.set(chat.id, agent);
		return agent;
	}

	private async _getResolvedModelSelection(
		projectId: string,
		modelSelection?: ModelSelection,
	): Promise<ModelSelection> {
		if (modelSelection) {
			return modelSelection;
		}

		// Get the first available provider config
		const configs = await llmConfigQueries.getProjectLlmConfigs(projectId);
		const config = configs.at(0);
		if (config) {
			return {
				provider: config.provider,
				modelId: getDefaultModelId(config.provider),
			};
		}

		// Fallback to env-based provider
		const envSelection = getEnvModelSelections().at(0);
		if (envSelection) {
			return envSelection;
		}

		throw Error('No model config found');
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
		modelSelection: ModelSelection,
	): Promise<Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>> {
		const config = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, modelSelection.provider);

		if (config) {
			return this._createProviderConfig(
				modelSelection.provider,
				config.apiKey,
				modelSelection.modelId,
				config.baseUrl,
			);
		}

		// No config but env var might exist - use it
		const envApiKey = getEnvApiKey(modelSelection.provider);
		if (envApiKey) {
			return this._createProviderConfig(modelSelection.provider, envApiKey, modelSelection.modelId);
		}

		throw Error('No model config found');
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

		if (provider === 'google') {
			const google = createGoogleGenerativeAI({
				apiKey,
				...(baseUrl && { baseURL: baseUrl }),
			});
			return {
				model: google.chat(modelId),
				providerOptions: {
					google: {
						...getProviderModelConfig(provider, modelId),
					} satisfies GoogleGenerativeAIProviderOptions,
				},
			};
		}

		if (provider === 'mistral') {
			const mistral = createMistral({
				apiKey,
				...(baseUrl && { baseURL: baseUrl }),
			});
			return {
				model: mistral.chat(modelId),
			};
		}

		const openai = createOpenAI({
			apiKey,
			...(baseUrl && { baseURL: baseUrl }),
		});
		return {
			model: openai.responses(modelId),
			providerOptions: {
				openai: {} satisfies OpenAIResponsesProviderOptions,
			},
		};
	}
}

class AgentManager {
	private readonly _agent: ToolLoopAgent<never, typeof tools, never>;

	constructor(
		readonly chat: AgentChat,
		modelConfig: Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>,
		private readonly _modelSelection: ModelSelection,
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
					llmProvider: this._modelSelection.provider,
					llmModelId: this._modelSelection.modelId,
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
