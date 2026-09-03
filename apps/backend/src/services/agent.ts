import type { CustomBoundarySet } from '@nao/shared';
import { fileExtension } from '@nao/shared/attachments';
import { markSupersededExecuteSqlParts } from '@nao/shared/execute-sql-parts';
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
	pruneMessages,
	stepCountIs,
	type StopCondition,
	StreamTextResult,
	ToolLoopAgent,
	UIMessageStreamWriter,
} from 'ai';

import { disableModelReasoning, fitThinkingBudget, getProviderMeta, ProviderModelResult } from '../agents/providers';
import { getSystemPromptOverride, hasNaoPromptPlaceholder, injectNaoPrompt } from '../agents/system-prompts';
import { llmTelemetry } from '../agents/telemetry';
import { getTools } from '../agents/tools';
import { createWebSearchTools } from '../agents/tools/web-search';
import { getConnections, getTableColumnsContent, getUserRules } from '../agents/user-rules';
import { ChatForkContextPrompt, MessagingProviderSystemPrompt, SystemPrompt } from '../components/ai';
import { DBChat } from '../db/abstractSchema';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as imageQueries from '../queries/image.queries';
import * as projectQueries from '../queries/project.queries';
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
import { McpToolContext, QueryResult, ToolContext } from '../types/tools';
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
	getProjectAvailableModels,
	getProjectDeclaredModels,
	resolveAnnotationModelId,
	resolveProviderModel,
	resolveProviderSettings,
} from '../utils/llm';
import { logger } from '../utils/logger';
import { extractConfiguredDatabases } from '../utils/nao-config';
import { addPromptCache } from '../utils/prompt-cache';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { sanitizeTitle, TITLE_MAX_OUTPUT_TOKENS, titleFromPrompt, titleGenerationUserMessage } from '../utils/title';
import { isStoragePath } from '../utils/tools';
import { formatErrorMessageForUI, truncateMiddle } from '../utils/utils';
import { listChartPlugins } from './chart-plugin';
import { compactionService } from './compaction';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { mcpService } from './mcp';
import { memoryService } from './memory';
import { getAzureAccessTokenForUser } from './microsoft-auth.service';
import { skillService } from './skill';
import { canGrepUserFiles } from './storage/user-files';
import { getStoryTemplateWarnings } from './story-template-validation';

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
	/** Rows returned by every `execute_sql` call of the run, keyed by query id */
	queryResults: Map<string, QueryResult>;
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
	/** Custom GeoJSON boundary sets defined by the project admin. */
	customBoundaries: CustomBoundarySet[];
}

/** Builds the tool set a run should expose. Callers pass one to `create` to customise tools. */
export type AgentToolsResolver = (context: AgentToolsContext) => AgentTools | Promise<AgentTools>;

/** Default tool set for interactive runs: all built-ins, MCP tools and web search. */
export const defaultAgentTools: AgentToolsResolver = ({ chat, agentSettings, webTools, customBoundaries }) =>
	getTools(agentSettings, webTools ?? {}, { testMode: chat.testMode, customBoundaries });

/** Default tool set minus the given built-ins — for runs whose surface cannot render them. */
export const defaultAgentToolsExcluding =
	(excludeBuiltinTools: string[]): AgentToolsResolver =>
	({ chat, agentSettings, webTools, customBoundaries }) =>
		getTools(agentSettings, webTools ?? {}, { testMode: chat.testMode, excludeBuiltinTools, customBoundaries });

/**
 * Admin-mode tool set: the same `execute_sql` tool the chat already uses (it
 * runs against nao's own app database when `ToolContext.adminMode` is set),
 * plus charting and follow-ups. Excludes the filesystem context tools.
 */
export const adminAgentTools: AgentToolsResolver = ({ chat, agentSettings }) =>
	getTools(
		agentSettings,
		{},
		{
			testMode: chat.testMode,
			builtinToolAllowlist: [
				'execute_sql',
				'read_query_result',
				'display_chart',
				'suggest_follow_ups',
				'story',
				'clarification',
			],
		},
	);

export async function buildToolContext(opts: {
	projectId: string;
	userId: string;
	chatId: string;
	agentSettings?: AgentSettings | null;
	adminMode?: boolean;
	supportsCustomCharts?: boolean;
}): Promise<ToolContext> {
	const base = await _buildContextBase(opts);
	return { ...base, chatId: opts.chatId, adminMode: opts.adminMode ?? false };
}

export async function buildMcpToolContext(opts: {
	projectId: string;
	userId: string;
	agentSettings?: AgentSettings | null;
}): Promise<McpToolContext> {
	const base = await _buildContextBase({ ...opts, supportsCustomCharts: false });
	return { ...base, chatId: null };
}

async function _buildContextBase(opts: {
	projectId: string;
	userId: string;
	agentSettings?: AgentSettings | null;
	supportsCustomCharts?: boolean;
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
		supportsCustomCharts: opts.supportsCustomCharts !== false,
		agentSettings,
		envVars,
		azureAccessToken,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}

export class AgentService {
	private _agents = new Map<string, AgentManager>();

	async assertBudget(projectId: string, modelSelection?: LlmSelectedModel, userId?: string): Promise<void> {
		const resolved = await this._getResolvedLlmSelectedModel(projectId, modelSelection);
		await assertBudgetNotExceeded(projectId, resolved.provider, userId);
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
			/**
			 * Admin mode: routes `execute_sql` to nao's own app-database views instead
			 * of the user's warehouse (see `ToolContext.adminMode`).
			 */
			adminMode?: boolean;
			/** Enables project-defined charts that render only in the web client. */
			supportsCustomCharts?: boolean;
		} = {},
	): Promise<AgentManager> {
		this._disposeAgent(chat.id);
		const resolvedLlmSelectedModel = await this._getResolvedLlmSelectedModel(chat.projectId, modelSelection);
		await assertBudgetNotExceeded(chat.projectId, resolvedLlmSelectedModel.provider, chat.userId);
		const modelConfig = await this._getModelConfig(chat.projectId, resolvedLlmSelectedModel);
		const [agentSettings, customBoundaries] = await Promise.all([
			projectQueries.getAgentSettings(chat.projectId),
			projectQueries.getCustomBoundaries(chat.projectId),
		]);
		const toolContext = await this._getToolContext(
			chat.projectId,
			chat.id,
			chat.userId,
			agentSettings,
			options.adminMode,
			options.supportsCustomCharts,
		);
		const webTools = await this._resolveWebTools(chat.projectId, resolvedLlmSelectedModel.provider, agentSettings);
		const resolveTools = options.tools ?? defaultAgentTools;
		const agentTools = await resolveTools({ chat, agentSettings, toolContext, webTools, customBoundaries });
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

		// Same order the model picker offers, across the database, nao_config.yaml and the environment.
		const available = await getProjectAvailableModels(projectId);
		const first = available.at(0);
		if (first) {
			return { provider: first.provider, modelId: first.modelId };
		}

		throw new HandlerError('BAD_REQUEST', 'No model config found');
	}

	private async _getToolContext(
		projectId: string,
		chatId: string,
		userId: string,
		agentSettings: AgentSettings | null,
		adminMode?: boolean,
		supportsCustomCharts?: boolean,
	): Promise<ToolContext> {
		return buildToolContext({ projectId, userId, chatId, agentSettings, adminMode, supportsCustomCharts });
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
	private readonly _finished: Promise<void>;
	private _resolveFinished: (() => void) | undefined;
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
		this._finished = new Promise((resolve) => {
			this._resolveFinished = resolve;
		});
		const callSettings = this._modelConfig.callSettings ?? {};
		const provider = this._modelSelection.provider;
		const providerOptions = fitThinkingBudget(this._modelConfig.providerOptions, this._maxOutputTokens);
		const providerParams = Object.values(providerOptions)[0];
		this._agent = new ToolLoopAgent({
			model: this._modelConfig.model,
			providerOptions,
			tools: this._agentTools,
			maxOutputTokens: this._maxOutputTokens,
			...(callSettings.temperature !== undefined && { temperature: callSettings.temperature }),
			...(callSettings.topP !== undefined && { topP: callSettings.topP }),
			...(callSettings.topK !== undefined && { topK: callSettings.topK }),
			prepareStep: async ({ messages }) => this._prepareStep(messages),
			stopWhen,
			experimental_context: this._toolContext,
			experimental_telemetry: llmTelemetry('nao-agent', {
				sessionId: this.chat.id,
				userId: this.chat.userId,
				tags: [provider],
				projectId: this.chat.projectId,
				model: this._modelSelection.modelId,
				...(callSettings.temperature !== undefined && { temperature: callSettings.temperature }),
				...(callSettings.topP !== undefined && { topP: callSettings.topP }),
				...(callSettings.topK !== undefined && { topK: callSettings.topK }),
				...(callSettings.maxOutputTokens !== undefined && { maxOutputTokens: callSettings.maxOutputTokens }),
				...(providerParams &&
					Object.keys(providerParams).length > 0 && { providerOptions: JSON.stringify(providerParams) }),
			}),
		});
	}

	private get _maxOutputTokens(): number {
		return this._modelConfig.callSettings?.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
	}

	private async _prepareStep(messages: ModelMessage[]): Promise<{ messages: ModelMessage[] }> {
		await compactionService.compactConversationIfNeeded({
			chat: this.chat,
			provider: this._modelSelection.provider,
			modelId: this._modelSelection.modelId,
			messages,
			tools: this._agentTools,
			maxOutputTokens: this._maxOutputTokens,
			contextWindow: this._modelConfig.contextWindow,
			onCompactionStarted: () => {
				this._streamWriter?.write({
					type: 'data-compactionSummaryStarted',
					data: null,
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
						onError: formatErrorMessageForUI,
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
						source: this._toolContext.adminMode ? 'admin' : settledMessage.source,
						stopReason,
						error,
						tokenUsage,
						llmProvider: this._modelSelection.provider,
						llmModelId: this._modelSelection.modelId,
					});
				} finally {
					this._finish();
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
		const uiMessagesWithoutStaleQueries = markSupersededExecuteSqlParts(settledUiMessages);
		const uiMessagesWithStories = await this._syncStoryToolOutputs(uiMessagesWithoutStaleQueries);
		const uiMessagesWithStoryMode = this._addStoryMode(uiMessagesWithStories, mentions);
		const uiMessagesWithSkills = this._addSkills(uiMessagesWithStoryMode, mentions);
		const uiMessagesWithCitation = this._addCitationContext(uiMessagesWithSkills);
		const uiMessagesWithDbContext = this._addDatabaseContext(uiMessagesWithCitation, mentions);
		const uiMessagesWithCompaction = compactionService.useLastCompaction(uiMessagesWithDbContext);
		const uiMessagesWithResolvedAttachments = await resolveAttachments(uiMessagesWithCompaction);

		const systemPrompt = this._systemPromptOverride ?? (await this._buildSystemPrompt(provider, timezone, chatUrl));

		const systemMessage: Omit<UIMessage, 'id'> = {
			role: 'system',
			parts: [{ type: 'text', text: systemPrompt }],
		};

		const modelMessages = await convertToModelMessages<UIMessage>(
			[systemMessage, ...uiMessagesWithResolvedAttachments],
			{
				tools: this._agentTools,
			},
		);

		return modelMessages;
	}

	private async _buildSystemPrompt(provider?: Provider, timezone?: string, chatUrl?: string): Promise<string> {
		const override = getSystemPromptOverride(this._toolContext.projectFolder, provider);
		if (override && !hasNaoPromptPlaceholder(override)) {
			return override;
		}

		const defaultPrompt = await this._buildDefaultSystemPrompt(provider, timezone, chatUrl);
		return override ? injectNaoPrompt(override, defaultPrompt) : defaultPrompt;
	}

	private async _buildDefaultSystemPrompt(provider?: Provider, timezone?: string, chatUrl?: string): Promise<string> {
		const memories = await memoryService.safeGetUserMemories(this.chat.userId, this.chat.projectId, this.chat.id);
		const userRules = getUserRules(this._toolContext.projectFolder);
		const connections = getConnections(this._toolContext.projectFolder);
		const configuredDatabases = extractConfiguredDatabases(this._toolContext.projectFolder);
		const skills = skillService.getSkills(this.chat.projectId);
		const customCharts = this._toolContext.supportsCustomCharts
			? listChartPlugins(this._toolContext.projectFolder)
			: [];
		const mcpServers = await mcpService.getEnabledServers(this.chat.projectId);
		const basePrompt = renderToMarkdown(
			SystemPrompt({
				memories,
				userRules,
				connections,
				configuredDatabases,
				skills,
				customCharts,
				mcpServers,
				timezone,
				testMode: this.chat.testMode,
				toolNames: Object.keys(this._agentTools),
				options: { canGrepSavedFiles: canGrepUserFiles() },
			}),
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
			const latestStories = new Map<
				string,
				{
					version: NonNullable<Awaited<ReturnType<typeof storyQueries.getLatestVersionByChatAndSlug>>>;
					templateWarnings: string[];
				}
			>();
			await Promise.all(
				[...lastToolCallByStory.keys()].map(async (storyId) => {
					const version = await storyQueries.getLatestVersionByChatAndSlug(this.chat.id, storyId);
					if (!version) {
						return;
					}
					latestStories.set(storyId, {
						version,
						templateWarnings: await getStoryTemplateWarnings(this.chat.id, version.code),
					});
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

					const latestStory = latestStories.get(storyId);
					if (!latestStory) {
						return part;
					}
					const { version: latest, templateWarnings } = latestStory;

					return {
						...part,
						output: {
							...part.output,
							version: latest.version,
							code: latest.code,
							title: latest.title,
							_editedByUser: latest.source === 'user',
							template_warnings: templateWarnings.length > 0 ? templateWarnings : undefined,
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
			modelId: this._modelSelection.modelId,
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
			this._modelSelection,
			getProviderMeta(provider).summaryModelId,
		);
		const modelResult = await resolveProviderModel(this.chat.projectId, provider, summaryModelId, false);
		if (!modelResult) {
			return;
		}

		const { text, usage } = await generateText({
			...disableModelReasoning(provider, modelResult),
			system: 'Generate a short, descriptive title (3-8 words) for this conversation based on the user message. Always generate a title, no matter the input. Only capitalize the first letter of the title and nouns. Answer with the title alone, without quotes or any other text.',
			messages: [
				{
					role: 'user',
					content: titleGenerationUserMessage(userMessageText),
				},
			],
			maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
			experimental_telemetry: llmTelemetry('nao-generate-title', {
				sessionId: this.chat.id,
				userId: this.chat.userId,
				tags: [provider],
			}),
		});

		this._trackTitleGenerationInference(modelResult.model.modelId, convertToTokenUsage(usage));

		const title = sanitizeTitle(text) || titleFromPrompt(userMessageText);
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

	private _trackTitleGenerationInference(modelId: string, usage: TokenUsage): void {
		scheduleSaveLlmInferenceRecord({
			type: 'title_generation',
			projectId: this.chat.projectId,
			userId: this.chat.userId,
			chatId: this.chat.id,
			llmProvider: this._modelSelection.provider,
			llmModelId: modelId,
			...usage,
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
			const customModels = await getProjectDeclaredModels(this.chat.projectId)
				.then(
					(sources) =>
						sources.find((source) => source.provider === this._modelSelection.provider)?.models ?? [],
				)
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
				queryResults: this._toolContext.queryResults,
			};
		} finally {
			this._finish();
		}
	}

	checkIsUserOwner(userId: string): boolean {
		return this.chat.userId === userId;
	}

	stop(): void {
		this._abortController.abort();
	}

	waitUntilFinished(): Promise<void> {
		return this._finished;
	}

	private _markFinished(): void {
		this._resolveFinished?.();
		this._resolveFinished = undefined;
	}

	private _finish(): void {
		try {
			this._onDispose();
		} finally {
			this._markFinished();
		}
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
		const skillContent = skillMention
			? skillService.getSkillContent(this.chat.projectId, skillMention.id)
			: undefined;
		if (!skillMention || !skillContent) {
			return messages;
		}
		const skill = truncateMiddle(skillContent, 16_000);
		return this._transformLastUserMessageText(messages, (text) =>
			this._expandSkillMention(text, skillMention, skill),
		);
	}

	private _expandSkillMention(text: string, mention: Mention, skill: string): string {
		const tokens = [`${mention.trigger}[${mention.label}]`, `${mention.trigger}[${mention.id}]`];
		const matchedToken = tokens.find((token) => text.includes(token));
		if (matchedToken) {
			return text.replaceAll(matchedToken, () => skill).trim();
		}
		const rest = text.trim();
		return rest ? `${skill}\n\n${rest}` : skill;
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
 * Turns the attachments of a conversation into something a provider can consume.
 *
 * An image is inlined: its `/i/{id}` URL becomes the raw base64 payload. The AI SDK's
 * `convertToModelMessages` maps `FileUIPart.url` → `FilePart.data`, and a data-URL string
 * (data:…) would be misread as a link to download — the mediaType already travels in its
 * own field, so the bare base64 string is what the provider needs.
 *
 * A document in permanent storage is replaced by a line naming where it lives. Its bytes
 * stay out of the context window; the model reads the path when the question needs it.
 */
async function resolveAttachments<T extends MessageLike>(messages: T[]): Promise<T[]> {
	const imageData = await loadImageData(messages);

	return messages.map((message) => ({
		...message,
		parts: message.parts.flatMap((part): UIMessagePart[] => {
			if (part.type !== 'file') {
				return [part];
			}

			const imageId = part.url.match(IMAGE_URL_PATTERN)?.[1];
			if (imageId) {
				const base64Data = imageData.get(imageId);
				return [base64Data ? { ...part, url: base64Data } : part];
			}

			if (isStoragePath(part.url)) {
				return [{ type: 'text' as const, text: describeStoredAttachment(part) }];
			}

			return [part];
		}),
	}));
}

async function loadImageData(messages: MessageLike[]): Promise<Map<string, string>> {
	const imageIds = new Set<string>();
	for (const message of messages) {
		for (const part of message.parts) {
			const imageId = part.type === 'file' ? part.url.match(IMAGE_URL_PATTERN)?.[1] : undefined;
			if (imageId) {
				imageIds.add(imageId);
			}
		}
	}

	const imageData = new Map<string, string>();
	await Promise.all(
		[...imageIds].map(async (id) => {
			const image = await imageQueries.getImageById(id);
			if (image) {
				imageData.set(id, image.data);
			}
		}),
	);

	return imageData;
}

function describeStoredAttachment(part: { url: string; mediaType: string; filename?: string }): string {
	const name = part.filename ?? part.url.split('/').pop();
	const workbookHint =
		fileExtension(name ?? '') === 'xlsx'
			? ' Reading a workbook gives you its sheet names and the shape of each, which is what you need before querying one.'
			: '';

	return `[The user attached ${name} (${part.mediaType}) to this message. It is saved at ${part.url}. Its contents are not included here: read that path when you need them.${workbookHint}]`;
}

// Singleton instance of the agent service
export const agentService = new AgentService();
