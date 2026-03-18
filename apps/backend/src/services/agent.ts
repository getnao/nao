import { story } from '@nao/shared/tools';
import {
	convertToModelMessages,
	createUIMessageStream,
	FinishReason,
	generateText,
	hasToolCall,
	InferUIMessageChunk,
	isToolUIPart,
	ModelMessage,
	Output,
	pruneMessages,
	StreamTextResult,
	ToolLoopAgent,
	UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';

import { CACHE_1H, CACHE_5M, LLM_PROVIDERS, ProviderModelResult } from '../agents/providers';
import { getTools } from '../agents/tools';
import { createWebSearchTools } from '../agents/tools/web-search';
import { getConnections, getTableColumnsContent, getUserRules } from '../agents/user-rules';
import { MessagingProviderSystemPrompt, SystemPrompt } from '../components/ai';
import { DBChat } from '../db/abstractSchema';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as storyQueries from '../queries/story.queries';
import { AgentSettings } from '../types/agent-settings';
import { AgentTools, Mention, MessageCustomDataParts, TokenCost, TokenUsage, UIMessage } from '../types/chat';
import { LlmProvider } from '../types/llm';
import { Provider } from '../types/messaging-provider';
import { ToolContext } from '../types/tools';
import { convertToCost, convertToTokenUsage, findLastUserMessage, getLastUserMessageText } from '../utils/ai';
import { HandlerError } from '../utils/error';
import {
	getDefaultModelId,
	getEnvModelSelections,
	ModelSelection,
	resolveProviderModel,
	resolveProviderSettings,
} from '../utils/llm';
import { truncateMiddle } from '../utils/utils';
import { compactionService } from './compaction';
import { memoryService } from './memory';
import { skillService } from './skill';

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

export type AgentChat = Pick<DBChat, 'id' | 'projectId' | 'userId'>;

export class AgentService {
	private _agents = new Map<string, AgentManager>();

	async create(chat: AgentChat, modelSelection?: ModelSelection): Promise<AgentManager> {
		this._disposeAgent(chat.id);
		const resolvedModelSelection = await this._getResolvedModelSelection(chat.projectId, modelSelection);
		const modelConfig = await this._getModelConfig(chat.projectId, resolvedModelSelection);
		const agentSettings = await projectQueries.getAgentSettings(chat.projectId);
		const toolContext = await this._getToolContext(chat.projectId, chat.id, agentSettings);
		const webTools = await this._resolveWebTools(chat.projectId, resolvedModelSelection.provider, agentSettings);
		const agentTools = getTools(agentSettings, webTools ?? undefined);
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
		const project = await projectQueries.retrieveProjectById(projectId);
		if (!project.path) {
			throw new HandlerError('BAD_REQUEST', 'Project path does not exist.');
		}
		return {
			projectFolder: project.path ?? '',
			chatId,
			agentSettings,
			queryResults: new Map(),
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

	private async _resolveWebTools(
		projectId: string,
		provider: LlmProvider,
		agentSettings: AgentSettings | null,
	): Promise<Record<string, unknown> | null> {
		if (!agentSettings?.webSearch?.enabled) {
			return null;
		}
		const settings = await resolveProviderSettings(projectId, provider);
		if (!settings) {
			return null;
		}
		return createWebSearchTools(provider, settings);
	}

	protected async _getModelConfig(projectId: string, modelSelection: ModelSelection): Promise<ProviderModelResult> {
		const result = await resolveProviderModel(projectId, modelSelection.provider, modelSelection.modelId);
		if (!result) {
			throw new HandlerError('BAD_REQUEST', 'The selected model could not be resolved.');
		}
		return result;
	}
}

const MAX_OUTPUT_TOKENS = 16_000;

class AgentManager {
	private readonly _agent: ToolLoopAgent<never, AgentTools, never>;
	private _streamWriter?: UIMessageStreamWriter<UIMessage>;

	constructor(
		readonly chat: AgentChat,
		private readonly _modelConfig: ProviderModelResult,
		private readonly _modelSelection: ModelSelection,
		private readonly _onDispose: () => void,
		private readonly _abortController: AbortController,
		private readonly _agentTools: AgentTools,
		private readonly _toolContext: ToolContext,
	) {
		this._agent = new ToolLoopAgent({
			model: this._modelConfig.model,
			providerOptions: this._modelConfig.providerOptions,
			tools: this._agentTools,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			prepareStep: async ({ messages }) => this._prepareStep(messages),
			stopWhen: [hasToolCall('suggest_follow_ups')],
			experimental_context: this._toolContext,
		});
	}

	private async _prepareStep(messages: ModelMessage[]): Promise<{ messages: ModelMessage[] }> {
		await compactionService.compactConversationIfNeeded({
			chat: this.chat,
			provider: this._modelSelection.provider,
			messages,
			tools: this._agentTools,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			contextWindow: this._modelConfig.contextWindow,
			onCompactionStarted: () => {
				this._streamWriter?.write({
					type: 'data-compactionSummaryStarted',
					data: undefined,
				});
			},
			onCompactionFinished: (result) => {
				this._streamWriter?.write({
					type: 'data-compaction',
					data: result,
				});
			},
		});

		return { messages: this._addCache(this._pruneMessages(messages)) };
	}

	stream(
		uiMessages: UIMessage[],
		opts: {
			events?: Partial<MessageCustomDataParts>;
			mentions?: Mention[];
			provider?: Provider;
			timezone?: string;
		} = {},
	): ReadableStream<InferUIMessageChunk<UIMessage>> {
		let error: unknown = undefined;
		let result: StreamTextResult<AgentTools, never> | undefined;

		return createUIMessageStream<UIMessage>({
			generateId: () => crypto.randomUUID(),
			execute: async ({ writer }) => {
				writer.write({ type: 'start' });

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
					});
				}

				this._streamWriter = writer;
				const messages = await this._buildModelMessages(
					uiMessages,
					opts.mentions,
					opts.provider,
					opts.timezone,
				);

				result = await this._agent.stream({
					messages,
					abortSignal: this._abortController.signal,
				});

				// Extract memory immediately after the request to the agent is sent
				this._scheduleMemoryExtraction(uiMessages);

				if (opts.events?.newChat) {
					this._scheduleTitleGeneration(getLastUserMessageText(uiMessages));
				}

				writer.merge(
					result.toUIMessageStream({
						sendStart: false,
					}),
				);
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
	 * Prepares the UI messages and builds them into model messages with memory and compaction summary.
	 */
	private async _buildModelMessages(
		uiMessages: UIMessage[],
		mentions?: Mention[],
		provider?: Provider,
		timezone?: string,
	): Promise<ModelMessage[]> {
		const uiMessagesWithStories = await this._syncStoryToolOutputs(uiMessages);
		const uiMessagesWithStoryMode = this._addStoryMode(uiMessagesWithStories, mentions);
		const uiMessagesWithSkills = this._addSkills(uiMessagesWithStoryMode, mentions);
		const uiMessagesWithDbContext = this._addDatabaseContext(uiMessagesWithSkills, mentions);
		const uiMessagesWithCompaction = compactionService.useLastCompaction(uiMessagesWithDbContext);

		const memories = await memoryService.safeGetUserMemories(this.chat.userId, this.chat.projectId, this.chat.id);
		const userRules = getUserRules();
		const connections = getConnections();
		const skills = skillService.getSkills();
		const basePrompt = renderToMarkdown(SystemPrompt({ memories, userRules, connections, skills, timezone }));
		const systemPrompt = provider
			? renderToMarkdown(MessagingProviderSystemPrompt({ basePrompt, provider }))
			: basePrompt;

		const systemMessage: Omit<UIMessage, 'id'> = {
			role: 'system',
			parts: [{ type: 'text', text: systemPrompt }],
		};

		const modelMessages = await convertToModelMessages<UIMessage>([systemMessage, ...uiMessagesWithCompaction], {
			tools: this._agentTools,
		});

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

	private _scheduleTitleGeneration(userMessageText: string): void {
		this._generateTitle(userMessageText).catch((err) => {
			console.error('[title] generation failed:', err);
		});
	}

	private async _generateTitle(userMessageText: string): Promise<void> {
		const provider = this._modelSelection.provider;
		const summaryModelId = LLM_PROVIDERS[provider].summaryModelId;
		const modelResult = await resolveProviderModel(this.chat.projectId, provider, summaryModelId);
		if (!modelResult) {
			return;
		}

		const { output } = await generateText({
			model: modelResult.model,
			system: 'Generate a short, descriptive title (3-8 words) for this conversation based on the user message. Always generate a title, no matter the input. Only capitalize the first letter of the title and nouns.',
			messages: [
				{
					role: 'user',
					content: userMessageText,
				},
			],
			output: Output.object({
				schema: z.object({
					title: z.string().describe('A short, descriptive conversation title (3-8 words)'),
				}),
			}),
			maxOutputTokens: 60,
		});

		const title = output?.title.trim();
		if (!title) {
			return;
		}

		await chatQueries.renameChat(this.chat.id, title);

		try {
			this._streamWriter?.write({ type: 'data-chatTitleUpdate', data: { title } });
		} catch {
			// Stream may already be closed — the DB is updated regardless
		}
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

	async generate(uiMessages: UIMessage[]): Promise<AgentRunResult> {
		const startTime = performance.now();
		const messages = await this._buildModelMessages(uiMessages);
		const result = await this._agent.generate({
			messages,
			abortSignal: this._abortController.signal,
			onFinish: () => {
				this._onDispose();
			},
		});
		const durationMs = Math.round(performance.now() - startTime);

		const usage = convertToTokenUsage(result.totalUsage);
		const cost = convertToCost(usage, this._modelSelection.provider, this._modelSelection.modelId);
		const finishReason = result.finishReason ?? 'stop';

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

	private _addStoryMode(messages: UIMessage[], mentions?: Mention[]): UIMessage[] {
		if (!mentions?.some((m) => m.id === story.MENTION_ID)) {
			return messages;
		}

		const STORY_INSTRUCTION =
			'[Story mode: present your response as an interactive nao Story using the story tool, combining markdown and charts]';
		return this._transformLastUserMessageText(messages, (text) => `${STORY_INSTRUCTION}\n\n${text}`);
	}

	private _addSkills(messages: UIMessage[], mentions?: Mention[]): UIMessage[] {
		const skillMention = mentions?.find((m) => m.trigger === '/');
		const skillContent = skillMention ? skillService.getSkillContent(skillMention.id) : undefined;
		if (!skillContent) {
			return messages;
		}
		return this._transformLastUserMessageText(messages, () => truncateMiddle(skillContent, 16_000));
	}

	private _addDatabaseContext(messages: UIMessage[], mentions?: Mention[]): UIMessage[] {
		const dbMentions = mentions?.filter((m) => m.trigger === '@') ?? [];
		if (dbMentions.length === 0) {
			return messages;
		}

		const contextParts: string[] = [];
		for (const mention of dbMentions) {
			const content = getTableColumnsContent(this._toolContext.projectFolder, mention.id);
			if (content) {
				contextParts.push(`[Table: ${mention.id}]\n${content}`);
			}
		}

		if (contextParts.length === 0) {
			return messages;
		}

		const dbContext = contextParts.join('\n\n');
		return this._transformLastUserMessageText(
			messages,
			(text) => `${text}\n\n---\nReferenced tables:\n${dbContext}`,
		);
	}

	private _transformLastUserMessageText(messages: UIMessage[], transform: (text: string) => string): UIMessage[] {
		const [lastUserMessage, lastUserMessageIndex] = findLastUserMessage(messages);
		if (!lastUserMessage) {
			return messages;
		}

		const textPartIndex = lastUserMessage.parts.findIndex((part) => part.type === 'text');
		if (textPartIndex === -1) {
			return messages;
		}

		const textPart = lastUserMessage.parts[textPartIndex] as { type: 'text'; text: string };
		const updatedMessages = [...messages];
		const newParts = [...lastUserMessage.parts];
		newParts[textPartIndex] = { type: 'text', text: transform(textPart.text) };
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
