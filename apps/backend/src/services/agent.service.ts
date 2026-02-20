import {
	convertToModelMessages,
	createUIMessageStream,
	FinishReason,
	hasToolCall,
	InferUIMessageChunk,
	ModelMessage,
	pruneMessages,
	StreamTextResult,
	ToolLoopAgent,
	ToolLoopAgentSettings,
} from 'ai';

import { CACHE_1H, CACHE_5M, createProviderModel } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/system-prompt';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { Mention, TokenCost, TokenUsage, UIChat, UIMessage } from '../types/chat';
import { ToolContext } from '../types/tools';
import {
	convertToCost,
	convertToTokenUsage,
	findLastUserMessage,
	getLastUserMessageText,
	retrieveProjectById,
} from '../utils/ai';
import { getDefaultModelId, getEnvApiKey, getEnvModelSelections, ModelSelection } from '../utils/llm';
import { memoryService } from './memory';
import { skillService } from './skill.service';

export type { ModelSelection };
type AgentTools = Awaited<ReturnType<typeof getTools>>;

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
		const agentSettings = await projectQueries.getAgentSettings(chat.projectId);
		const toolContext = await this._getToolContext(chat.projectId);
		const agentTools = getTools(agentSettings);
		const agent = new AgentManager(
			chat,
			modelConfig,
			resolvedModelSelection,
			() => this._agents.delete(chat.id),
			abortController,
			agentTools,
			toolContext,
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

	private async _getToolContext(projectId: string): Promise<ToolContext> {
		const project = await retrieveProjectById(projectId);
		if (!project.path) {
			throw Error('Project path does not exist.');
		}
		return {
			projectFolder: project.path ?? '',
		};
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
	private readonly _agent: ToolLoopAgent<never, AgentTools, never>;

	constructor(
		readonly chat: AgentChat,
		private readonly _modelConfig: Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>,
		private readonly _modelSelection: ModelSelection,
		private readonly _onDispose: () => void,
		private readonly _abortController: AbortController,
		private readonly _agentTools: AgentTools,
		private readonly _toolContext: ToolContext,
	) {
		this._agent = new ToolLoopAgent({
			...this._modelConfig,
			tools: this._agentTools,
			maxOutputTokens: 16_000,
			prepareStep: ({ messages }) => ({
				messages: this._addCache(this._pruneMessages(messages)),
			}),
			stopWhen: [hasToolCall('suggest_follow_ups')],
			experimental_context: this._toolContext,
		});
	}

	stream(
		uiMessages: UIMessage[],
		opts: {
			sendNewChatData: boolean;
			mentions?: Mention[];
		},
	): ReadableStream<InferUIMessageChunk<UIMessage>> {
		let error: unknown = undefined;
		let result: StreamTextResult<AgentTools, never>;

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

				const messages = await this._buildModelMessages(uiMessages, opts.mentions);

				result = await this._agent.stream({
					messages,
					abortSignal: this._abortController.signal,
				});

				// Extract memory immediately after the request to the agent is sent
				this._scheduleMemoryExtraction(uiMessages);

				writer.merge(result.toUIMessageStream({}));
			},
			onError: (err) => {
				error = err;
				return String(err);
			},
			onFinish: async (e) => {
				const stopReason = e.isAborted ? 'interrupted' : e.finishReason;
				const tokenUsage = await this._getTotalUsage(result);
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

	/**
	 * Prepares the UI messages and builds them into model messages with memory.
	 */
	private async _buildModelMessages(uiMessages: UIMessage[], mentions?: Mention[]): Promise<ModelMessage[]> {
		uiMessages = this._addSkills(uiMessages, mentions);
		uiMessages = this._fillEmptyAssistantTurns(uiMessages, '[NO CONTENT]');
		const modelMessages = await convertToModelMessages(uiMessages);
		const memories = await memoryService.safeGetUserMemories(this.chat.userId, this.chat.id);
		const systemPrompt = renderToMarkdown(SystemPrompt({ memories }));
		const systemMessage: ModelMessage = { role: 'system', content: systemPrompt };
		modelMessages.unshift(systemMessage);
		return modelMessages;
	}

	private _scheduleMemoryExtraction(uiMessages: UIMessage[]): void {
		const lastUserText = getLastUserMessageText(uiMessages);
		if (lastUserText) {
			memoryService.safeScheduleMemoryExtraction({
				userId: this.chat.userId,
				projectId: this.chat.projectId,
				chatId: this.chat.id,
				userMessage: lastUserText,
				provider: this._modelSelection.provider,
			});
		}
	}

	private async _getTotalUsage(
		result: StreamTextResult<ReturnType<typeof getTools>, never>,
	): Promise<TokenUsage | undefined> {
		try {
			// totalUsage promise will throw if an error occured during the streaming
			return convertToTokenUsage(await result.totalUsage);
		} catch (error) {
			void error;
			return undefined;
		}
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
			steps: result.steps as AgentRunResult['steps'],
		};
	}

	checkIsUserOwner(userId: string): boolean {
		return this.chat.userId === userId;
	}

	stop(): void {
		this._abortController.abort();
	}

	private _fillEmptyAssistantTurns(messages: UIMessage[], fillText: string): UIMessage[] {
		return messages.map((msg) => {
			if (msg.role !== 'assistant') {
				return msg;
			}
			const hasTextPart = msg.parts.some((part) => part.type === 'text');
			if (!hasTextPart) {
				msg.parts.push({ type: 'text', text: fillText });
			}
			return msg;
		});
	}

	private _addSkills(messages: UIMessage[], mentions?: Mention[]): UIMessage[] {
		const skillMention = mentions?.find((m) => m.trigger === '/');
		if (!skillMention) {
			return messages;
		}

		const skillContent = skillService.getSkillContent(skillMention.id);
		if (!skillContent) {
			return messages;
		}

		const [lastUserMessage, lastUserMessageIndex] = findLastUserMessage(messages);
		if (!lastUserMessage) {
			return messages;
		}

		const updatedMessages = [...messages];
		const textPartIndex = lastUserMessage.parts.findIndex((part) => part.type === 'text');
		const newParts = [...lastUserMessage.parts];
		newParts[textPartIndex] = { type: 'text', text: skillContent };
		updatedMessages[lastUserMessageIndex] = { ...lastUserMessage, parts: newParts };

		return updatedMessages;
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

		const lastIndex = messages.length - 1;
		if (messages[0].role === 'system') {
			messages[0] = withCache(messages[0], CACHE_1H);
		}
		if (messages.length > 1) {
			messages[lastIndex] = withCache(messages[lastIndex], CACHE_5M);
		}
		return messages;
	}

	/**
	 * Prunes certain messages parts like reasoning and tool calls from the conversation.
	 */
	private _pruneMessages(messages: ModelMessage[]): ModelMessage[] {
		return pruneMessages({
			messages,
			reasoning: 'before-last-message',
			toolCalls: [{ tools: ['suggest_follow_ups'], type: 'all' }],
			emptyMessages: 'remove',
		});
	}

	getModelId(): string {
		return this._modelSelection.modelId;
	}
}

// Singleton instance of the agent service
export const agentService = new AgentService();
