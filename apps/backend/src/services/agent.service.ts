import {
	convertToModelMessages,
	createUIMessageStream,
	FinishReason,
	hasToolCall,
	InferUIMessageChunk,
	isToolUIPart,
	ModelMessage,
	pruneMessages,
	StreamTextResult,
	ToolLoopAgent,
	ToolLoopAgentSettings,
} from 'ai';

import { CACHE_1H, CACHE_5M } from '../agents/providers';
import { getTools } from '../agents/tools';
import { getConnections, getUserRules } from '../agents/user-rules';
import { SystemPrompt } from '../components/ai';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as storyQueries from '../queries/story.queries';
import { AgentSettings } from '../types/agent-settings';
import { Mention, MessageCustomDataParts, TokenCost, TokenUsage, UIChat, UIMessage } from '../types/chat';
import { ToolContext } from '../types/tools';
import { convertToCost, convertToTokenUsage, findLastUserMessage, retrieveProjectById } from '../utils/ai';
import { HandlerError } from '../utils/error';
import { getDefaultModelId, getEnvModelSelections, ModelSelection, resolveProviderModel } from '../utils/llm';
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

	async create(chat: AgentChat, modelSelection?: ModelSelection): Promise<AgentManager> {
		this._disposeAgent(chat.id);
		const resolvedModelSelection = await this._getResolvedModelSelection(chat.projectId, modelSelection);
		const modelConfig = await this._getModelConfig(chat.projectId, resolvedModelSelection);
		const agentSettings = await projectQueries.getAgentSettings(chat.projectId);
		const toolContext = await this._getToolContext(chat.projectId, chat.id, agentSettings);
		const agentTools = getTools(agentSettings);
		const agent = new AgentManager(
			chat,
			modelConfig,
			resolvedModelSelection,
			() => this._agents.delete(chat.id),
			new AbortController(),
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

		throw new HandlerError('BAD_REQUEST', 'No model config found');
	}

	private async _getToolContext(
		projectId: string,
		chatId: string,
		agentSettings: AgentSettings | null,
	): Promise<ToolContext> {
		const project = await retrieveProjectById(projectId);
		if (!project.path) {
			throw new HandlerError('BAD_REQUEST', 'Project path does not exist.');
		}
		return {
			projectFolder: project.path ?? '',
			chatId,
			agentSettings,
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
		const result = await resolveProviderModel(projectId, modelSelection.provider, modelSelection.modelId);
		if (!result) {
			throw new HandlerError('BAD_REQUEST', 'The selected model could not be resolved.');
		}
		return result;
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
			events?: Partial<MessageCustomDataParts>;
			mentions?: Mention[];
		} = {},
	): ReadableStream<InferUIMessageChunk<UIMessage>> {
		let error: unknown = undefined;
		let result: StreamTextResult<AgentTools, never> | undefined;

		return createUIMessageStream<UIMessage>({
			generateId: () => crypto.randomUUID(),
			execute: async ({ writer }) => {
				if (opts.events?.newChat) {
					writer.write({
						type: 'data-newChat',
						data: opts.events.newChat,
					});
				}

				if (opts.events?.newUserMessage) {
					writer.write({
						type: 'data-newUserMessage',
						data: opts.events.newUserMessage,
						transient: true,
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
				try {
					const stopReason = e.isAborted ? 'interrupted' : e.finishReason;
					const tokenUsage = await this._getTotalUsage(result);
					await chatQueries.upsertMessage({
						...e.responseMessage,
						chatId: this.chat.id,
						stopReason,
						error,
						tokenUsage,
						llmProvider: this._modelSelection.provider,
						llmModelId: this._modelSelection.modelId,
					});
				} finally {
					this._onDispose();
				}
			},
		});
	}

	/**
	 * Prepares the UI messages and builds them into model messages with memory.
	 */
	private async _buildModelMessages(uiMessages: UIMessage[], mentions?: Mention[]): Promise<ModelMessage[]> {
		uiMessages = this._addSkills(uiMessages, mentions);
		uiMessages = await this._syncStoryToolOutputs(uiMessages);
		const modelMessages = await convertToModelMessages(uiMessages, { tools: this._agentTools });
		const memories = await memoryService.safeGetUserMemories(this.chat.userId, this.chat.projectId, this.chat.id);
		const userRules = getUserRules();
		const connections = getConnections();
		const skills = skillService.getSkills();
		const systemPrompt = renderToMarkdown(SystemPrompt({ memories, userRules, connections, skills }));
		const systemMessage: ModelMessage = { role: 'system', content: systemPrompt };
		modelMessages.unshift(systemMessage);
		return modelMessages;
	}

	/**
	 * Sync story tool outputs with the DB and deduplicate: only the last occurrence
	 * of each story carries the full content; earlier ones are marked `_stale` so the
	 * model sees a short placeholder instead of redundant code.
	 */
	private async _syncStoryToolOutputs(messages: UIMessage[]): Promise<UIMessage[]> {
		type StoryPart = Extract<UIMessage['parts'][number], { type: 'tool-story'; state: 'output-available' }>;
		const isStoryPart = (part: UIMessage['parts'][number]): part is StoryPart =>
			isToolUIPart(part) && part.type === 'tool-story' && part.state === 'output-available';

		const lastToolCallByStory = new Map<string, string>();
		for (const message of messages) {
			for (const part of message.parts) {
				if (isStoryPart(part) && part.output.id) {
					lastToolCallByStory.set(part.output.id, part.toolCallId);
				}
			}
		}

		if (lastToolCallByStory.size === 0) {
			return messages;
		}

		try {
			const latestVersions = new Map<string, Awaited<ReturnType<typeof storyQueries.getLatestVersion>>>();
			await Promise.all(
				[...lastToolCallByStory.keys()].map(async (storyId) => {
					latestVersions.set(storyId, await storyQueries.getLatestVersion(this.chat.id, storyId));
				}),
			);

			return messages.map((message) => ({
				...message,
				parts: message.parts.map((part) => {
					if (!isStoryPart(part) || !part.output.id) {
						return part;
					}

					const storyId = part.output.id;

					if (lastToolCallByStory.get(storyId) !== part.toolCallId) {
						return { ...part, output: { ...part.output, _stale: true, code: '' } };
					}

					const latest = latestVersions.get(storyId);
					if (!latest) {
						return part;
					}

					return {
						...part,
						output: {
							...part.output,
							version: latest.version,
							code: latest.code,
							title: latest.title,
							_editedByUser: latest.source === 'user',
						},
					};
				}),
			}));
		} catch {
			return messages;
		}
	}

	private _scheduleMemoryExtraction(uiMessages: UIMessage[]): void {
		memoryService.safeScheduleMemoryExtraction({
			userId: this.chat.userId,
			projectId: this.chat.projectId,
			chatId: this.chat.id,
			messages: uiMessages,
			provider: this._modelSelection.provider,
		});
	}

	private async _getTotalUsage(
		result: StreamTextResult<ReturnType<typeof getTools>, never> | undefined,
	): Promise<TokenUsage | undefined> {
		if (!result) {
			return undefined;
		}

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
