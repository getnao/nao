import { story } from '@nao/shared/tools';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
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
	stepCountIs,
	type StopCondition,
	StreamTextResult,
	ToolLoopAgent,
	UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';

import { LLM_PROVIDERS, ProviderModelResult } from '../agents/providers';
import { getTools } from '../agents/tools';
import { createWebSearchTools } from '../agents/tools/web-search';
import { getConnections, getTableColumnsContent, getUserRules } from '../agents/user-rules';
import { ChatForkContextPrompt, MessagingProviderSystemPrompt, SystemPrompt } from '../components/ai';
import { DBChat } from '../db/abstractSchema';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as imageQueries from '../queries/image.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as storyQueries from '../queries/story.queries';
import { AgentSettings } from '../types/agent-settings';
import {
	AgentTools,
	ForkMetadata,
	Mention,
	MessageCustomDataParts,
	TokenCost,
	TokenUsage,
	UIMessage,
	UIMessagePart,
} from '../types/chat';
import type { ModelCosts } from '../types/llm';
import { Provider } from '../types/messaging-provider';
import { McpToolContext, ToolContext } from '../types/tools';
import {
	convertToCost,
	convertToTokenUsage,
	findLastUserMessage,
	getLastUserMessageText,
	settleInterruptedToolParts,
} from '../utils/ai';
import { assertBudgetNotExceeded } from '../utils/budget';
import { HandlerError } from '../utils/error';
import {
	getDefaultModelId,
	getEnvModelSelections,
	resolveAnnotationModelId,
	resolveProviderModel,
	resolveProviderSettings,
} from '../utils/llm';
import { logger } from '../utils/logger';
import { addPromptCache } from '../utils/prompt-cache';
import { truncateMiddle } from '../utils/utils';
import { compactionService } from './compaction';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { memoryService } from './memory';
import { getAzureAccessTokenForUser } from './microsoft-auth.service';
import { skillService } from './skill';

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
	/** All message parts (step-starts, tool calls, text) for persisting to the DB */
	responseParts: UIMessagePart[];
}

export type AgentChat = Pick<DBChat, 'id' | 'projectId' | 'userId'> & {
	forkMetadata?: ForkMetadata | null;
	testMode?: boolean;
};

/** Dependencies a tool resolver receives once a run's context has been resolved. */
export interface AgentToolsContext {
	chat: AgentChat;
	agentSettings: AgentSettings | null;
	toolContext: ToolContext;
	/** Web-search tools resolved from project settings, or null when web search is disabled. */
	webTools: Record<string, unknown> | null;
}

/** Builds the tool set a run should expose. Callers pass one to `create` to customise tools. */
export type AgentToolsResolver = (context: AgentToolsContext) => AgentTools | Promise<AgentTools>;

/** Default tool set for interactive runs: all built-ins, MCP tools and web search. */
export const defaultAgentTools: AgentToolsResolver = ({ chat, agentSettings, webTools }) =>
	getTools(agentSettings, webTools ?? {}, { testMode: chat.testMode });

export async function buildToolContext(opts: {
	projectId: string;
	userId: string;
	chatId: string;
	agentSettings?: AgentSettings | null;
}): Promise<ToolContext> {
	const base = await _buildContextBase(opts);
	return { ...base, chatId: opts.chatId };
}

export async function buildMcpToolContext(opts: {
	projectId: string;
	userId: string;
	agentSettings?: AgentSettings | null;
}): Promise<McpToolContext> {
	const base = await _buildContextBase(opts);
	return { ...base, chatId: null };
}

async function _buildContextBase(opts: {
	projectId: string;
	userId: string;
	agentSettings?: AgentSettings | null;
}): Promise<Omit<ToolContext, 'chatId'>> {
	const project = await projectQueries.retrieveProjectById(opts.projectId);
	if (!project.path) {
		throw new HandlerError('BAD_REQUEST', 'Project path does not exist.');
	}
	const agentSettings =
		opts.agentSettings !== undefined ? opts.agentSettings : await projectQueries.getAgentSettings(opts.projectId);
	const [envVars, azureAccessToken] = await Promise.all([
		projectQueries.getEnvVars(opts.projectId),
		hasFeature(LICENSE_FEATURES.sso).then((has) => (has ? getAzureAccessTokenForUser(opts.userId) : null)),
	]);
	return {
		projectFolder: project.path,
		userId: opts.userId,
		projectId: opts.projectId,
		agentSettings,
		envVars,
		azureAccessToken,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], stories: [] },
	};
}

export class AgentService {
	private _agents = new Map<string, AgentManager>();

	async assertBudget(projectId: string, modelSelection?: LlmSelectedModel): Promise<void> {
		const resolved = await this._getResolvedLlmSelectedModel(projectId, modelSelection);
		await assertBudgetNotExceeded(projectId, resolved.provider);
	}

	/** Resolves the concrete model a run will use (project default when none is configured). */
	async resolveModelSelection(projectId: string, modelSelection?: LlmSelectedModel): Promise<LlmSelectedModel> {
		return this._getResolvedLlmSelectedModel(projectId, modelSelection);
	}

	async create(
		chat: AgentChat,
		modelSelection?: LlmSelectedModel,
		options: {
			/**
			 * Resolves the tool set the run exposes. Defaults to `defaultAgentTools`
			 * (all built-ins, MCP and web search). Pass a custom resolver to restrict
			 * or extend the tools (e.g. automations, context recommendations).
			 */
			tools?: AgentToolsResolver;
			/**
			 * Removes `suggest_follow_ups` and switches the loop's stop condition
			 * to a step counter. Used by non-interactive runs (e.g. automations)
			 * where suggesting follow-ups would prematurely end the loop
			 * before outbound integration tools fire.
			 */
			excludeFollowUps?: boolean;
			/**
			 * Step budget for the `excludeFollowUps` stop condition. Defaults to 20.
			 * Longer analyses (e.g. context recommendations) raise this so the loop
			 * is not cut off before it finishes recording.
			 */
			maxSteps?: number;
			/**
			 * Replaces the standard system prompt with a fully formed prompt. Skips the
			 * default instructions, user rules (RULES.md), memories and connections —
			 * used by runs where that context is the subject of the task rather than
			 * authoritative guidance (e.g. context recommendations).
			 */
			systemPrompt?: string;
		} = {},
	): Promise<AgentManager> {
		this._disposeAgent(chat.id);
		const resolvedLlmSelectedModel = await this._getResolvedLlmSelectedModel(chat.projectId, modelSelection);
		await assertBudgetNotExceeded(chat.projectId, resolvedLlmSelectedModel.provider);
		const modelConfig = await this._getModelConfig(chat.projectId, resolvedLlmSelectedModel);
		const agentSettings = await projectQueries.getAgentSettings(chat.projectId);
		const toolContext = await this._getToolContext(chat.projectId, chat.id, chat.userId, agentSettings);
		const webTools = await this._resolveWebTools(chat.projectId, resolvedLlmSelectedModel.provider, agentSettings);
		const resolveTools = options.tools ?? defaultAgentTools;
		const agentTools = await resolveTools({ chat, agentSettings, toolContext, webTools });
		const stopWhen: StopCondition<AgentTools>[] = options.excludeFollowUps
			? [stepCountIs(options.maxSteps ?? 20)]
			: chat.testMode
				? [hasToolCall('suggest_follow_ups')]
				: [hasToolCall('suggest_follow_ups'), hasToolCall('clarification')];
		const agent = new AgentManager(
			chat,
			modelConfig,
			resolvedLlmSelectedModel,
			() => this._agents.delete(chat.id),
			new AbortController(),
			agentTools,
			toolContext,
			stopWhen,
			options.systemPrompt,
		);
		this._agents.set(chat.id, agent);
		return agent;
	}

	protected async _getResolvedLlmSelectedModel(
		projectId: string,
		modelSelection?: LlmSelectedModel,
	): Promise<LlmSelectedModel> {
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
		userId: string,
		agentSettings: AgentSettings | null,
	): Promise<ToolContext> {
		return buildToolContext({ projectId, userId, chatId, agentSettings });
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

	protected async _getModelConfig(projectId: string, modelSelection: LlmSelectedModel): Promise<ProviderModelResult> {
		const result = await resolveProviderModel(projectId, modelSelection.provider, modelSelection.modelId);
		if (!result) {
			throw new HandlerError('BAD_REQUEST', 'The selected model could not be resolved.');
		}
		return result;
	}
}

export const MAX_OUTPUT_TOKENS = 16_000;

class AgentManager {
	private readonly _agent: ToolLoopAgent<never, AgentTools, never>;
	private _streamWriter?: UIMessageStreamWriter<UIMessage>;

	constructor(
		readonly chat: AgentChat,
		private readonly _modelConfig: ProviderModelResult,
		private readonly _modelSelection: LlmSelectedModel,
		private readonly _onDispose: () => void,
		private readonly _abortController: AbortController,
		private readonly _agentTools: AgentTools,
		private readonly _toolContext: ToolContext,
		stopWhen: StopCondition<AgentTools>[] = [hasToolCall('suggest_follow_ups'), hasToolCall('clarification')],
		private readonly _systemPromptOverride?: string,
	) {
		this._agent = new ToolLoopAgent({
			model: this._modelConfig.model,
			providerOptions: this._modelConfig.providerOptions,
			tools: this._agentTools,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			prepareStep: async ({ messages }) => this._prepareStep(messages),
			stopWhen,
			experimental_context: this._toolContext,
		});
	}

	private async _prepareStep(messages: ModelMessage[]): Promise<{ messages: ModelMessage[] }> {
		// await compactionService.compactConversationIfNeeded({
		// 	chat: this.chat,
		// 	provider: this._modelSelection.provider,
		// 	messages,
		// 	tools: this._agentTools,
		// 	maxOutputTokens: MAX_OUTPUT_TOKENS,
		// 	contextWindow: this._modelConfig.contextWindow,
		// 	onCompactionStarted: () => {
		// 		this._streamWriter?.write({
		// 			type: 'data-compactionSummaryStarted',
		// 			data: undefined,
		// 		});
		// 	},
		// 	onCompactionFinished: (result) => {
		// 		this._streamWriter?.write({
		// 			type: 'data-compaction',
		// 			data: result,
		// 		});
		// 	},
		// });

		return { messages: this._addCache(this._pruneMessages(messages)) };
	}

	get generatedArtifacts(): ToolContext['generatedArtifacts'] {
		return this._toolContext.generatedArtifacts;
	}

	get queryResultsSummary(): {
		id: string;
		columns: string[];
		row_count: number;
		preview: Record<string, unknown>[];
	}[] {
		return [...this._toolContext.queryResults.entries()].map(([id, result]) => ({
			id,
			columns: result.columns,
			row_count: result.data.length,
			preview: result.data.slice(0, 3),
		}));
	}

	stream(
		uiMessages: UIMessage[],
		opts: {
			events?: Partial<MessageCustomDataParts>;
			mentions?: Mention[];
			provider?: Provider;
			timezone?: string;
			chatUrl?: string;
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
					opts.chatUrl,
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
				logger.error(`Agent stream error: ${String(err)}`, {
					source: 'agent',
					projectId: this.chat.projectId,
					context: { chatId: this.chat.id, modelId: this._modelSelection.modelId },
				});
				return String(err);
			},
			onFinish: async (e) => {
				try {
					const stopReason = e.isAborted ? 'interrupted' : e.finishReason;
					const tokenUsage = await this._getTotalUsage(result);
					const [settledMessage] = settleInterruptedToolParts([e.responseMessage]);
					await chatQueries.upsertMessage({
						...settledMessage,
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
		chatUrl?: string,
	): Promise<ModelMessage[]> {
		const settledUiMessages = settleInterruptedToolParts(uiMessages);
		const uiMessagesWithStories = await this._syncStoryToolOutputs(settledUiMessages);
		const uiMessagesWithStoryMode = this._addStoryMode(uiMessagesWithStories, mentions);
		const uiMessagesWithSkills = this._addSkills(uiMessagesWithStoryMode, mentions);
		const uiMessagesWithCitation = this._addCitationContext(uiMessagesWithSkills);
		const uiMessagesWithDbContext = this._addDatabaseContext(uiMessagesWithCitation, mentions);
		const uiMessagesWithCompaction = compactionService.useLastCompaction(uiMessagesWithDbContext);
		const uiMessagesWithResolvedImages = await resolveImageUrls(uiMessagesWithCompaction);

		const systemPrompt = this._systemPromptOverride ?? (await this._buildSystemPrompt(provider, timezone, chatUrl));

		const systemMessage: Omit<UIMessage, 'id'> = {
			role: 'system',
			parts: [{ type: 'text', text: systemPrompt }],
		};

		const modelMessages = await convertToModelMessages<UIMessage>(
			[systemMessage, ...uiMessagesWithResolvedImages],
			{
				tools: this._agentTools,
			},
		);

		return modelMessages;
	}

	/** Builds the standard system prompt (instructions + user rules + memories + connections). */
	private async _buildSystemPrompt(provider?: Provider, timezone?: string, chatUrl?: string): Promise<string> {
		const memories = await memoryService.safeGetUserMemories(this.chat.userId, this.chat.projectId, this.chat.id);
		const userRules = getUserRules(this._toolContext.projectFolder);
		const connections = getConnections(this._toolContext.projectFolder);
		const skills = skillService.getSkills();
		const basePrompt = renderToMarkdown(
			SystemPrompt({ memories, userRules, connections, skills, timezone, testMode: this.chat.testMode }),
		);
		const renderedPrompt = provider
			? renderToMarkdown(MessagingProviderSystemPrompt({ basePrompt, provider, chatUrl }))
			: basePrompt;
		return this.chat.forkMetadata
			? renderToMarkdown(
					ChatForkContextPrompt({ basePrompt: renderedPrompt, forkMetadata: this.chat.forkMetadata }),
				)
			: renderedPrompt;
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
			const latestVersions = new Map<
				string,
				Awaited<ReturnType<typeof storyQueries.getLatestVersionByChatAndSlug>>
			>();
			await Promise.all(
				[...lastToolCallByStory.keys()].map(async (storyId) => {
					latestVersions.set(
						storyId,
						await storyQueries.getLatestVersionByChatAndSlug(this.chat.id, storyId),
					);
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
			logger.error(`Title generation failed: ${String(err)}`, {
				source: 'agent',
				projectId: this.chat.projectId,
				context: { chatId: this.chat.id },
			});
		});
	}

	private async _generateTitle(userMessageText: string): Promise<void> {
		const provider = this._modelSelection.provider;
		const summaryModelId = await resolveAnnotationModelId(
			this.chat.projectId,
			provider,
			LLM_PROVIDERS[provider].summaryModelId,
		);
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

	async generate(
		uiMessages: UIMessage[],
		opts: {
			provider?: Provider;
			timezone?: string;
			chatUrl?: string;
			costs?: ModelCosts;
		} = {},
	): Promise<AgentRunResult> {
		const startTime = performance.now();
		const messages = await this._buildModelMessages(
			uiMessages,
			undefined,
			opts.provider,
			opts.timezone,
			opts.chatUrl,
		);
		try {
			const result = await this._agent.generate({
				messages,
				abortSignal: this._abortController.signal,
			});
			const durationMs = Math.round(performance.now() - startTime);

			const usage = convertToTokenUsage(result.totalUsage);
			const customModels = await llmConfigQueries
				.getProjectLlmConfigByProvider(this.chat.projectId, this._modelSelection.provider)
				.then((c) => c?.customModels ?? [])
				.catch(() => []);
			const cost = convertToCost(
				usage,
				this._modelSelection.provider,
				this._modelSelection.modelId,
				customModels,
				opts.costs,
			);
			const finishReason = result.finishReason ?? 'stop';

			return {
				text: result.text,
				usage,
				cost,
				finishReason,
				durationMs,
				responseMessages: result.response.messages,
				steps: result.steps as AgentRunResult['steps'],
				responseParts: [],
			};
		} finally {
			this._onDispose();
		}
	}

	checkIsUserOwner(userId: string): boolean {
		return this.chat.userId === userId;
	}

	stop(): void {
		this._abortController.abort();
	}

	private _addCitationContext(messages: UIMessage[]): UIMessage[] {
		const [lastUserMessage] = findLastUserMessage(messages);
		if (!lastUserMessage?.citation) {
			return messages;
		}

		const { start, end, text: citationText } = lastUserMessage.citation;
		const context = `[The user is referring to the following text selection (chars ${start}–${end}):\n"${citationText}"]`;
		return this._transformLastUserMessageText(messages, (text) => (text ? `${context}\n\n${text}` : context));
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
	 * Applies to direct Anthropic, Vertex Claude, and Bedrock Anthropic models.
	 *
	 * Cache strategy:
	 * - System message: 1h TTL (instructions rarely change)
	 * - Last message: 5m TTL (current step's leaf for agentic caching)
	 */
	private _addCache(messages: ModelMessage[]): ModelMessage[] {
		return addPromptCache(messages, this._modelSelection);
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

const IMAGE_URL_PATTERN = /^\/i\/([a-f0-9-]+)$/;

type MessageLike = Omit<UIMessage, 'id'>;

/**
 * Replaces server-relative image URLs (/i/{id}) with raw base64 data so the
 * model provider receives the actual image content inline.
 *
 * The AI SDK's `convertToModelMessages` maps `FileUIPart.url` → `FilePart.data`.
 * A data-URL string (data:…) would be misinterpreted as a downloadable URL,
 * so we pass the plain base64 string instead — the mediaType is already a
 * separate field on the part.
 */
async function resolveImageUrls<T extends MessageLike>(messages: T[]): Promise<T[]> {
	const imageIds = new Set<string>();
	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type === 'file') {
				const match = part.url.match(IMAGE_URL_PATTERN);
				if (match) {
					imageIds.add(match[1]);
				}
			}
		}
	}

	if (imageIds.size === 0) {
		return messages;
	}

	const imageDataMap = new Map<string, string>();
	await Promise.all(
		[...imageIds].map(async (id) => {
			const image = await imageQueries.getImageById(id);
			if (image) {
				imageDataMap.set(id, image.data);
			}
		}),
	);

	return messages.map((message) => ({
		...message,
		parts: message.parts.map((part) => {
			if (part.type !== 'file') {
				return part;
			}
			const match = part.url.match(IMAGE_URL_PATTERN);
			if (!match) {
				return part;
			}
			const base64Data = imageDataMap.get(match[1]);
			console.log(`[debug] base64Data for ${match[1]}: ${base64Data}`);
			if (!base64Data) {
				return part;
			}
			return {
				...part,
				url: base64Data,
			};
		}),
	}));
}

// Singleton instance of the agent service
export const agentService = new AgentService();
