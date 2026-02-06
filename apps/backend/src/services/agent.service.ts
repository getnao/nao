import {
	convertToModelMessages,
	createUIMessageStream,
	FinishReason,
	hasToolCall,
	ModelMessage,
	StreamTextResult,
	ToolLoopAgent,
	ToolLoopAgentSettings,
} from 'ai';

import { getInstructions } from '../agents/prompt';
import { CACHE_1H, CACHE_5M, createProviderModel } from '../agents/providers';
import { tools } from '../agents/tools';
import * as chatQueries from '../queries/chat.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { TokenCost, TokenUsage, UIChat, UIMessage } from '../types/chat';
import { convertToCost, convertToTokenUsage } from '../utils/chat';
import { getDefaultModelId, getEnvApiKey, getEnvModelSelections, ModelSelection } from '../utils/llm';

export type { ModelSelection };

export interface AgentRunResult {
	text: string;
	usage: TokenUsage;
	cost: TokenCost;
	finishReason: FinishReason;
	/** Duration of the agent run in milliseconds */
	durationMs: number;
	/** Response messages in ModelMessage format - can be used directly for follow-up calls */
	responseMessages: ModelMessage[];
	/** Raw steps from the agent - can be used to extract tool calls if needed */
	steps: ReadonlyArray<{
		toolCalls: ReadonlyArray<{ toolName: string; toolCallId: string; input: unknown }>;
		toolResults: ReadonlyArray<{ toolCallId: string; output?: unknown }>;
	}>;
}

type AgentChat = UIChat & {
	userId: string;
	projectId: string;
};

export class AgentService {
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

	protected async _getResolvedModelSelection(
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

	protected async _getModelConfig(
		projectId: string,
		modelSelection: ModelSelection,
	): Promise<Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>> {
		const config = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, modelSelection.provider);

		if (config) {
			return createProviderModel(
				modelSelection.provider,
				{
					apiKey: config.apiKey,
					...(config.baseUrl && { baseURL: config.baseUrl }),
				},
				modelSelection.modelId,
			);
		}

		// No config but env var might exist - use it
		const envApiKey = getEnvApiKey(modelSelection.provider);
		if (envApiKey) {
			return createProviderModel(modelSelection.provider, { apiKey: envApiKey }, modelSelection.modelId);
		}

		throw Error('No model config found');
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
			// On step 1+: cache user message (stable) + current step's last message (loop leaf)
			prepareStep: ({ messages }) => {
				return { messages: this._addCache(messages) };
			},
			stopWhen: [hasToolCall('suggest_follow_ups')],
		});
	}

	stream(
		uiMessages: UIMessage[],
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

				const messages = await this._buildModelMessages(uiMessages);

				result = await this._agent.stream({
					messages,
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

	async generate(messages: UIMessage[]): Promise<AgentRunResult> {
		const startTime = performance.now();
		const result = await this._agent.generate({
			messages: await this._buildModelMessages(messages),
			abortSignal: this._abortController.signal,
		});
		const durationMs = Math.round(performance.now() - startTime);

		const usage = convertToTokenUsage(result.totalUsage);
		const cost = convertToCost(usage, this._modelSelection.provider, this._modelSelection.modelId);
		const finishReason = result.finishReason ?? 'stop';

		this._onDispose();
		return {
			text: result.text,
			usage,
			cost,
			finishReason,
			durationMs,
			responseMessages: result.response.messages,
			steps: result.steps,
		};
	}

	checkIsUserOwner(userId: string): boolean {
		return this.chat.userId === userId;
	}

	stop(): void {
		this._abortController.abort();
	}

	/** Builds and prepares the UI messages into model messages */
	private async _buildModelMessages(uiMessages: UIMessage[]): Promise<ModelMessage[]> {
		uiMessages = this._prepareUIMessages(uiMessages);
		const modelMessages = await convertToModelMessages(uiMessages);
		const systemMessage: ModelMessage = { role: 'system', content: getInstructions() };
		modelMessages.unshift(systemMessage);
		return modelMessages;
	}

	private _prepareUIMessages(messages: UIMessage[]): UIMessage[] {
		return messages.map((msg) => {
			if (msg.role !== 'assistant') {
				return msg;
			}

			const hasTextPart = msg.parts.some((part) => part.type === 'text');
			if (!hasTextPart) {
				msg.parts.push({ type: 'text', text: '[NO CONTENT]' });
			}

			const filteredParts = msg.parts.filter((part) => part.type !== 'tool-suggest_follow_ups');
			if (filteredParts.length === msg.parts.length) {
				return msg;
			}

			return { ...msg, parts: filteredParts };
		});
	}

	/**
	 * Add Anthropic cache breakpoints to messages.
	 * No-op for non-Anthropic providers.
	 *
	 * Cache strategy:
	 * - System message: 1h TTL (instructions rarely change)
	 * - Last message: 5m TTL (current step's leaf for agentic caching)
	 */
	private _addCache(messages: ModelMessage[]): ModelMessage[] {
		if (messages.length === 0 || this._modelSelection.provider !== 'anthropic') {
			return messages;
		}

		const withCache = (msg: ModelMessage, cache: typeof CACHE_1H | typeof CACHE_5M): ModelMessage => ({
			...msg,
			providerOptions: {
				...msg.providerOptions,
				anthropic: { ...msg.providerOptions?.anthropic, cacheControl: cache },
			},
		});

		const first = messages[0];
		const last = messages.at(-1)!;
		if (first.role === 'system') {
			withCache(first, CACHE_1H);
		}
		if (last !== first) {
			withCache(last, CACHE_5M);
		}
		return messages;
	}

	getModelId(): string {
		return this._modelSelection.modelId;
	}
}

// Singleton instance of the agent service
export const agentService = new AgentService();
