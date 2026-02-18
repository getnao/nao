import {
	convertToModelMessages,
	createUIMessageStream,
	FinishReason,
	generateText,
	hasToolCall,
	ModelMessage,
	StreamTextResult,
	ToolLoopAgent,
	ToolLoopAgentSettings,
	UIMessageStreamWriter,
} from 'ai';

import { CACHE_1H, CACHE_5M, createProviderModel } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/system-prompt';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { AgentSettings } from '../types/agent-settings';
import { Mention, TokenCost, TokenUsage, UIChat, UIMessage } from '../types/chat';
import { convertToCost, convertToTokenUsage, findLastUserMessage, retrieveProjectById } from '../utils/chat';
import { getDefaultModelId, getEnvApiKey, getEnvModelSelections, ModelSelection } from '../utils/llm';
import { skillService } from './skill.service';

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

const SUMMARY_NOTICE_TEXT = 'Conversation has been summarized.';
const SUMMARY_STREAM_MESSAGE = 'Conversation was summarized to continue despite context limits.';
const SUMMARY_PROMPT = `Summarize the prior conversation for continuation.
Include:
- user goals and intent
- key facts, entities, and decisions
- important constraints and unresolved questions
Keep it concise and factual.
Output plain text only.`;

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
		const agent = new AgentManager(
			chat,
			modelConfig,
			resolvedModelSelection,
			() => this._agents.delete(chat.id),
			abortController,
			agentSettings,
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
	private readonly _agent: ToolLoopAgent<never, ReturnType<typeof getTools>, never>;
	private readonly _modelConfig: Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>;

	constructor(
		readonly chat: AgentChat,
		modelConfig: Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'>,
		private readonly _modelSelection: ModelSelection,
		private readonly _onDispose: () => void,
		private readonly _abortController: AbortController,
		agentSettings: AgentSettings | null,
	) {
		this._modelConfig = modelConfig;
		this._agent = new ToolLoopAgent({
			...modelConfig,
			tools: getTools(agentSettings),
			maxOutputTokens: 16_000,
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
			mentions?: Mention[];
		},
	): ReadableStream {
		let error: unknown = undefined;
		let result: StreamTextResult<ReturnType<typeof getTools>, never>;

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

				// Fetch project path and run agent within project context
				const project = await retrieveProjectById(this.chat.projectId);
				const projectPath = project.path;
				if (!projectPath) {
					throw new Error(`Project path not configured: ${this.chat.projectId}`);
				}

				const messages = await this._buildModelMessages(uiMessages, opts.mentions);
				result = await this._streamWithCompaction(messages, uiMessages, opts.mentions, writer, projectPath);

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

	private async _streamWithCompaction(
		modelMessages: ModelMessage[],
		uiMessages: UIMessage[],
		mentions: Mention[] | undefined,
		writer: UIMessageStreamWriter<UIMessage>,
		projectFolder: string,
	): Promise<StreamTextResult<ReturnType<typeof getTools>, never>> {
		try {
			return await this._agent.stream({
				messages: modelMessages,
				abortSignal: this._abortController.signal,
				// @ts-expect-error - experimental_context is not yet in the types
				experimental_context: { projectFolder },
			});
		} catch (error) {
			if (!this._isContextLimitError(error)) {
				throw error;
			}

			const summary = await this._summarizeWithRetry(uiMessages, mentions);
			if (!summary) {
				const fallbackMessages = this._truncateForFallback(modelMessages);
				return await this._agent.stream({
					messages: fallbackMessages,
					abortSignal: this._abortController.signal,
					// @ts-expect-error - experimental_context is not yet in the types
					experimental_context: { projectFolder },
				});
			}

			const summaryMessage = this._createSummaryMessage(summary);
			await chatQueries.upsertMessage(summaryMessage, {
				chatId: this.chat.id,
				llmProvider: this._modelSelection.provider,
				llmModelId: this._modelSelection.modelId,
			});

			writer.write({
				type: 'data-summaryGenerated',
				data: { message: SUMMARY_STREAM_MESSAGE },
			});

			const compactedMessages = this._buildCompactedMessages(uiMessages, summaryMessage);
			const compactedModelMessages = await this._buildModelMessages(compactedMessages, mentions);
			return await this._agent.stream({
				messages: compactedModelMessages,
				abortSignal: this._abortController.signal,
				// @ts-expect-error - experimental_context is not yet in the types
				experimental_context: { projectFolder },
			});
		}
	}

	private async _summarizeWithRetry(uiMessages: UIMessage[], mentions?: Mention[]): Promise<string | null> {
		const prepared = this._prepareUIMessages(uiMessages, mentions);
		const toSummarize = this._messagesToSummarize(prepared);
		if (toSummarize.length === 0) {
			return null;
		}

		const attempts: UIMessage[][] = [toSummarize, toSummarize.slice(Math.max(0, toSummarize.length - 16))];
		for (const attempt of attempts) {
			try {
				const modelMessages = await convertToModelMessages(attempt);
				const { text } = await generateText({
					model: this._modelConfig.model,
					providerOptions: this._modelConfig.providerOptions,
					system: SUMMARY_PROMPT,
					messages: modelMessages,
					abortSignal: this._abortController.signal,
				});
				const summary = text.trim();
				if (summary) {
					return summary;
				}
			} catch {
				// retry once with a smaller window
			}
		}

		return null;
	}

	private _messagesToSummarize(messages: UIMessage[]): UIMessage[] {
		const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === 'user');
		if (lastUserIndex === -1) {
			return messages;
		}
		const absoluteLastUserIndex = messages.length - 1 - lastUserIndex;
		return messages.slice(0, absoluteLastUserIndex);
	}

	private _createSummaryMessage(summary: string): UIMessage {
		return {
			id: crypto.randomUUID(),
			role: 'assistant',
			parts: [
				{ type: 'text', text: SUMMARY_NOTICE_TEXT },
				{ type: 'reasoning', text: summary },
			],
		};
	}

	private _buildCompactedMessages(uiMessages: UIMessage[], summaryMessage: UIMessage): UIMessage[] {
		const lastUser = findLastUserMessage(uiMessages);
		if (lastUser.index === -1) {
			return [summaryMessage];
		}
		return [summaryMessage, lastUser.message];
	}

	private _truncateForFallback(messages: ModelMessage[]): ModelMessage[] {
		if (messages.length <= 18) {
			return messages;
		}
		const system = messages[0]?.role === 'system' ? [messages[0]] : [];
		const tail = messages.slice(-16);
		return [...system, ...tail];
	}

	private _isContextLimitError(error: unknown): boolean {
		const message = String(error ?? '').toLowerCase();
		return (
			message.includes('context_length_exceeded') ||
			message.includes('context length') ||
			message.includes('context window') ||
			message.includes('maximum context') ||
			message.includes('prompt is too long') ||
			message.includes('input is too long')
		);
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

	/** Builds and prepares the UI messages into model messages */
	private async _buildModelMessages(uiMessages: UIMessage[], mentions?: Mention[]): Promise<ModelMessage[]> {
		uiMessages = this._prepareUIMessages(uiMessages, mentions);
		uiMessages = this._trimToLastSummary(uiMessages);
		const modelMessages = await convertToModelMessages(uiMessages);
		const systemPrompt = renderToMarkdown(SystemPrompt());
		const systemMessage: ModelMessage = { role: 'system', content: systemPrompt };
		modelMessages.unshift(systemMessage);
		return modelMessages;
	}

	private _trimToLastSummary(messages: UIMessage[]): UIMessage[] {
		const lastSummaryIndex = [...messages]
			.reverse()
			.findIndex(
				(m) =>
					m.role === 'assistant' &&
					m.parts.some((p) => p.type === 'text' && p.text.trim() === SUMMARY_NOTICE_TEXT),
			);
		if (lastSummaryIndex === -1) {
			return messages;
		}
		const absoluteIndex = messages.length - 1 - lastSummaryIndex;
		return messages.slice(absoluteIndex);
	}

	private _prepareUIMessages(messages: UIMessage[], mentions?: Mention[]): UIMessage[] {
		messages = this._addSkills(messages, mentions);

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

	private _addSkills(messages: UIMessage[], mentions?: Mention[]): UIMessage[] {
		const skillMention = mentions?.find((m) => m.trigger === '/');
		if (!skillMention) {
			return messages;
		}

		const skillContent = skillService.getSkillContent(skillMention.id);
		if (!skillContent) {
			return messages;
		}

		const { message: lastUserMessage, index: lastUserMessageIndex } = findLastUserMessage(messages);
		if (lastUserMessageIndex === -1) {
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

	getModelId(): string {
		return this._modelSelection.modelId;
	}
}

// Singleton instance of the agent service
export const agentService = new AgentService();
