import { createMemoryState } from '@chat-adapter/state-memory';
import { stripAssistantTags } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Chat, deriveChannelId, type Logger as ChatLogger, Message, Thread, ThreadImpl } from 'chat';
import { createMattermostAdapter, type MattermostAdapter } from 'chat-adapter-mattermost';

import { generateChartImage } from '../components/generate-chart';
import type { User } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { listProjectsWithMattermostEnabled, type MattermostConfig } from '../queries/project-mattermost-config.queries';
import { getUser, getUserByMessagingProviderCode } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { logger } from '../utils/logger';
import {
	createLiveToolCall,
	createMattermostAnswerMessage,
	createSummaryToolCalls,
	EXCLUDED_TOOLS,
	formatClarificationText,
	formatMessagingError,
	getMessagingProviderWebhookUrl,
	renderMapImage,
	resolveMattermostCallbackBaseUrl,
} from '../utils/messaging-provider';
import { agentService } from './agent';
import {
	cacheMattermostEmail,
	createMattermostActionSecret,
	createMattermostFeedbackMetadata,
	createMattermostMarkdownTable,
	createMattermostStopAttachment,
	fetchMattermostPost,
	fetchMattermostUserEmail,
	fetchMattermostUserProfile,
	getMattermostLoginCommandForUnlinkedUser,
	getMattermostPostBaseProps,
	hasExplicitMattermostMention,
	MATTERMOST_FEEDBACK_PROP,
	MATTERMOST_POST_MAX_LENGTH,
	type MattermostAuthorType,
	type MattermostEmailCache,
	type MattermostPostPlacement,
	patchMattermostAnswerPost,
	resolveMattermostAccount,
	resolveMattermostReactionFeedback,
	resolveMattermostSqlOutput,
	resolveMattermostThreadId,
	shouldHandleMattermostMessage,
	truncateMattermostMarkdown,
	verifyMattermostFeedbackMetadata,
} from './mattermost-helpers';
import { posthog, PostHogEvent } from './posthog';

/** Mattermost throttles frequent post edits and the adapter has no rate-limit backoff. */
const UPDATE_INTERVAL_MS = 1000;

type MattermostConversationContext = Omit<ConversationContext, 'blocks' | 'textBlockIndex'> & {
	answerTextPartIndex: number;
	bodyParts: string[];
};

type MattermostAnswerPostState = {
	baseProps: Record<string, unknown>;
	message: string;
	stopAttached: boolean;
	appliedStopAttached: boolean;
};

class ProjectMattermostBot {
	private readonly _bot: Chat;
	private readonly _adapter: MattermostAdapter;
	private readonly _callbackUrl: string | undefined;
	private readonly _emailByMattermostId: MattermostEmailCache = new Map();
	private readonly _isBotByMattermostId: Map<string, boolean> = new Map();
	private readonly _answerPostMutations = new Map<string, Promise<void>>();
	private readonly _answerPostStates = new Map<string, MattermostAnswerPostState>();

	constructor(private readonly _config: MattermostConfig) {
		this._callbackUrl = _config.interactiveButtonsEnabled
			? getMessagingProviderWebhookUrl(
					resolveMattermostCallbackBaseUrl(_config.callbackUrl, _config.redirectUrl),
					'mattermost',
					_config.projectId,
				)
			: undefined;
		this._adapter = createMattermostAdapter({
			baseUrl: _config.baseUrl,
			botToken: _config.botToken,
			callbackUrl: this._callbackUrl,
			userName: 'nao',
		});
		this._bot = new Chat({
			userName: 'nao',
			adapters: { mattermost: this._adapter },
			logger: createMattermostLogger(_config.projectId),
			state: createMemoryState(),
		});
		this._registerHandlers();
	}

	public get config(): MattermostConfig {
		return this._config;
	}

	public get adapter(): MattermostAdapter {
		return this._adapter;
	}

	public async start(): Promise<void> {
		await this._bot.initialize();
	}

	public async stop(): Promise<void> {
		await this._adapter.disconnect();
	}

	private _registerHandlers(): void {
		const handleMessage = async (thread: Thread, message: Message): Promise<void> => {
			if (await this._shouldHandleMessage(thread, message)) {
				await this._handleMessage(thread, message);
			}
		};
		this._bot.onNewMention(handleMessage);
		this._bot.onSubscribedMessage(handleMessage);
		this._bot.onNewMessage(/[\s\S]+/, handleMessage);

		this._bot.onAction('stop_generation', async (event) => {
			const threadId = event.thread?.id || '';
			const cleanup = this._setStopAttachment(event.messageId, false);
			const actionChat = await this._resolveThreadChat(threadId);
			if (actionChat) {
				agentService.get(actionChat.id)?.stop();
			}
			await cleanup;
		});

		this._bot.onReaction(async (event) => {
			await this._handleReactionFeedback({
				added: event.added,
				emojiName: event.emoji.name,
				isBot: event.user.isMe || event.user.isBot === true,
				postId: event.messageId,
				post: event.message?.raw as MattermostPostPlacement | undefined,
			});
		});
	}

	private async _shouldHandleMessage(thread: Thread, message: Message): Promise<boolean> {
		const authorType = await this._resolveMessageAuthorType(message);
		const isDirectMessage = this._adapter.isDM(thread.id);
		const post = message.raw as MattermostPostPlacement;
		const isThreadReply = Boolean(post.root_id);
		const hasRawMention = hasExplicitMattermostMention(post, {
			userId: this._adapter.botUserId,
			userName: this._adapter.userName,
		});
		const isExplicitMention = hasRawMention || (!isDirectMessage && message.isMention === true);
		const needsThreadContext = authorType === 'human' && !isExplicitMention && (!isDirectMessage || isThreadReply);
		const threadContext = needsThreadContext
			? await this._resolveMessageThreadContext(thread, post, isDirectMessage)
			: { hasExistingChat: false };
		return shouldHandleMattermostMessage({
			isDirectMessage,
			isThreadReply,
			isMention: isExplicitMention,
			...threadContext,
			authorType,
			isOwnMessage: message.author.isMe,
		});
	}

	private async _resolveMessageThreadContext(
		thread: Thread,
		post: MattermostPostPlacement,
		isDirectMessage: boolean,
	): Promise<{ hasExistingChat: boolean }> {
		const threadId = isDirectMessage ? resolveMattermostThreadId(this._adapter, post, true) : thread.id;
		const existingChat = await chatQueries.getChatByMattermostThread(threadId);
		return { hasExistingChat: Boolean(existingChat) };
	}

	private async _resolveMessageAuthorType(message: Message): Promise<MattermostAuthorType> {
		if (message.author.isMe) {
			return 'unknown';
		}
		if (message.author.isBot === true) {
			return 'bot';
		}
		if (message.author.isBot === false) {
			return 'human';
		}
		const mattermostId = this._getMattermostId(message);
		if (!mattermostId) {
			this._warnUnknownMattermostAuthor('the message has no Mattermost user ID');
			return 'unknown';
		}
		const cached = this._isBotByMattermostId.get(mattermostId);
		if (cached !== undefined) {
			return cached ? 'bot' : 'human';
		}
		try {
			const profile = await fetchMattermostUserProfile({
				baseUrl: this._config.baseUrl,
				botToken: this._config.botToken,
				userId: mattermostId,
			});
			if (!profile) {
				this._warnUnknownMattermostAuthor('the Mattermost user profile was unavailable');
				return 'unknown';
			}
			this._isBotByMattermostId.set(mattermostId, profile.isBot);
			cacheMattermostEmail(this._emailByMattermostId, mattermostId, profile.email);
			return profile.isBot ? 'bot' : 'human';
		} catch (error) {
			this._warnUnknownMattermostAuthor(String(error));
			return 'unknown';
		}
	}

	private _warnUnknownMattermostAuthor(reason: string): void {
		logger.warn(
			`Could not verify Mattermost message author (${reason}); direct messages and mentions will still be handled, but unmentioned thread follow-ups will be skipped.`,
			{
				source: 'system',
				projectId: this._config.projectId,
			},
		);
	}

	private async _handleMessage(thread: Thread, message: Message): Promise<void> {
		const resolvedThread = this._resolveMessageThread(thread, message);
		message.text = message.text.replace(/(?:<at>[^<]*<\/at>|@\S+)\s*/g, '').trim();
		const linkedUser = await this._resolveLinkedUser(message);
		const loginCommand = getMattermostLoginCommandForUnlinkedUser(message.text, Boolean(linkedUser));
		if (loginCommand) {
			await this._handleLoginCommand(resolvedThread, message, loginCommand.code);
			return;
		}
		await this._handleWorkflow(resolvedThread, message);
	}

	private _resolveMessageThread(thread: Thread, message: Message): Thread {
		const post = message.raw as MattermostPostPlacement;
		const threadId = resolveMattermostThreadId(this._adapter, post, this._adapter.isDM(thread.id));
		if (threadId === thread.id) {
			return thread;
		}
		return new ThreadImpl({
			adapter: this._adapter,
			stateAdapter: this._bot.getState(),
			id: threadId,
			channelId: deriveChannelId(this._adapter, threadId),
			initialMessage: message,
			currentMessage: message,
			isDM: true,
			streamingUpdateIntervalMs: UPDATE_INTERVAL_MS,
		});
	}

	private async _handleWorkflow(thread: Thread, userMessage: Message): Promise<void> {
		const ctx: MattermostConversationContext = {
			thread,
			userMessage,
			user: null,
			chatId: '',
			convMessage: null,
			answerTextPartIndex: -1,
			bodyParts: [],
			textBlockCount: 0,
			isNewChat: false,
			modelId: undefined,
			timezone: undefined,
		};

		try {
			await this._validateUserAccess(ctx);
			ctx.convMessage = await ctx.thread.post('✨ nao is answering...');
			this._answerPostStates.set(ctx.convMessage.id, {
				baseProps: getMattermostPostBaseProps(ctx.convMessage.raw),
				message: '✨ nao is answering...',
				stopAttached: false,
				appliedStopAttached: false,
			});
			await this._saveOrUpdateUserMessage(ctx);

			const [chat] = await chatQueries.getChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx);
		} catch (error) {
			if (!ctx.convMessage) {
				return;
			}
			ctx.bodyParts = [formatMessagingError(error)];
			await this._editAnswerMessage(ctx);
		} finally {
			if (ctx.convMessage) {
				await this._setStopAttachment(ctx.convMessage.id, false);
				this._answerPostStates.delete(ctx.convMessage.id);
				this._answerPostMutations.delete(ctx.convMessage.id);
			}
		}
	}

	private async _validateUserAccess(ctx: MattermostConversationContext): Promise<void> {
		await this._getUser(ctx);
		await this._checkUserBelongsToProject(ctx);
	}

	private async _handleLoginCommand(thread: Thread, message: Message, code: string): Promise<void> {
		const mattermostId = this._getMattermostId(message);
		if (!mattermostId) {
			await thread.post('❌ Could not retrieve your Mattermost identity.');
			return;
		}
		if (!code) {
			await thread.post('❌ Invalid code. Usage: `login <your-code>`');
			return;
		}

		const user = await getUserByMessagingProviderCode(code);
		if (!user) {
			await thread.post('❌ Invalid linking code. Check your code in the project settings.');
			return;
		}

		cacheMattermostEmail(this._emailByMattermostId, mattermostId, user.email);
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	private _getMattermostId(message: Message): string | null {
		const raw = message.raw as { user_id?: string };
		return raw?.user_id || null;
	}

	private async _getUser(ctx: MattermostConversationContext): Promise<void> {
		const mattermostId = this._getMattermostId(ctx.userMessage);
		if (!mattermostId) {
			throw new Error('Could not retrieve user identity from Mattermost');
		}

		const user = await this._resolveLinkedUser(ctx.userMessage);
		if (!user) {
			await ctx.thread.post(
				'👋 I could not match your Mattermost email. Send `login <your-code>` to link manually. Find your code in project settings.',
			);
			throw new Error('User not linked');
		}
		ctx.user = user;
	}

	private async _resolveLinkedUser(message: Message): Promise<User | null> {
		const mattermostId = this._getMattermostId(message);
		if (!mattermostId) {
			return null;
		}
		try {
			return await resolveMattermostAccount({
				userId: mattermostId,
				emailCache: this._emailByMattermostId,
				fetchEmail: () =>
					fetchMattermostUserEmail({
						baseUrl: this._config.baseUrl,
						botToken: this._config.botToken,
						userId: mattermostId,
					}),
				findUser: (email) => getUser({ email }),
			});
		} catch (error) {
			logger.warn(`Failed to resolve Mattermost user email: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			return null;
		}
	}

	private async _checkUserBelongsToProject(ctx: MattermostConversationContext): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this._config.projectId, ctx.user!.id);
		if (role !== 'admin' && role !== 'user' && role !== 'context_admin') {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(ctx: MattermostConversationContext): Promise<void> {
		const text = ctx.userMessage.text;
		const existingChat = await chatQueries.getChatByMattermostThread(ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				source: 'mattermost',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
			return;
		}

		const title = createChatTitle({ text });
		const [createdChat] = await chatQueries.createChat(
			{
				title,
				userId: ctx.user!.id,
				projectId: this._config.projectId,
				mattermostThreadId: ctx.thread.id,
			},
			{ text, source: 'mattermost' },
		);
		ctx.chatId = createdChat.id;
		ctx.isNewChat = true;
	}

	private async _handleStreamAgent(chat: UIChat, ctx: MattermostConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const answerPostId = ctx.convMessage?.id;
		try {
			if (answerPostId) {
				await this._setStopAttachment(answerPostId, true);
			}
			const { lastMessage } = await this._readStreamAndUpdateMessage(stream, ctx);

			const chatUrl = new URL(ctx.chatId, this._config.redirectUrl).toString();
			await this._editAnswerMessage(ctx, chatUrl);
			if (answerPostId) {
				await this._setStopAttachment(answerPostId, false);
			}
			await this._attachAnswerAndSeedReactions(ctx, lastMessage?.id);

			posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
				project_id: this._config.projectId,
				chat_id: ctx.chatId,
				model_id: ctx.modelId,
				is_new_chat: ctx.isNewChat,
				source: 'mattermost',
				domain_host: new URL(this._config.redirectUrl).host,
			});
		} finally {
			if (answerPostId) {
				await this._setStopAttachment(answerPostId, false);
			}
		}
	}

	private async _createAgentStream(
		chat: UIChat,
		ctx: MattermostConversationContext,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this._config.projectId },
			this._config.modelSelection,
			{ supportsCustomCharts: false },
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'mattermost', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: MattermostConversationContext,
	): Promise<StreamState & { lastMessage: UIMessage | null }> {
		const state: StreamState = {
			renderedToolCallIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};
		let lastMessage: UIMessage | null = null;

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			for (const sqlPart of uiMessage.parts) {
				if (sqlPart.type === 'tool-execute_sql') {
					this._handleSqlPart(sqlPart, state);
				}
			}
			for (const chartPart of uiMessage.parts) {
				if (chartPart.type === 'tool-display_chart') {
					await this._handleChartPart(chartPart, state, ctx);
				}
			}
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (!part) {
				continue;
			}
			if (part.type.startsWith('tool-') && !EXCLUDED_TOOLS.includes(part.type)) {
				await this._handleCollapsibleToolPart(
					part as Extract<UIMessagePart, { toolCallId: string }>,
					state,
					ctx,
				);
			}
			if (part.type === 'text') {
				this._flushToolGroup(state, ctx);
				await this._handleTextPart(part, state, ctx);
			} else if (part.type === 'tool-display_map') {
				await this._handleMapPart(part, state, ctx);
			} else if (part.type === 'tool-clarification') {
				this._handleClarificationPart(part, state, ctx);
			}
			lastMessage = uiMessage;
		}

		await this._sendFinalText(ctx);
		return { ...state, lastMessage };
	}

	private async _editAnswerMessage(ctx: MattermostConversationContext, chatUrl?: string): Promise<void> {
		const answerMessage = ctx.convMessage;
		if (!answerMessage) {
			return;
		}
		const linkLength = chatUrl ? createMattermostAnswerMessage('', chatUrl).markdown.length + 2 : 0;
		const body = truncateMattermostMarkdown(
			this._renderBody(ctx),
			Math.max(MATTERMOST_POST_MAX_LENGTH - linkLength, 0),
		);
		const message = createMattermostAnswerMessage(body, chatUrl).markdown;
		await this._patchAnswerPost(answerMessage.id, (state) => {
			state.message = message;
		});
	}

	private _handleClarificationPart(
		part: Extract<UIMessagePart, { type: 'tool-clarification' }>,
		state: StreamState,
		ctx: MattermostConversationContext,
	): void {
		if (part.state === 'input-streaming' || !part.input) {
			return;
		}
		this._flushToolGroup(state, ctx);
		this._updateTextBlock(formatClarificationText(part.input.question, part.input.options), ctx);
	}

	private async _handleTextPart(
		part: Extract<UIMessagePart, { type: 'text' }>,
		state: StreamState,
		ctx: MattermostConversationContext,
	): Promise<void> {
		this._updateTextBlock(part.text, ctx);
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS || !part.text) {
			return;
		}
		await this._editAnswerMessage(ctx);
		state.lastUpdateAt = Date.now();
	}

	private _handleSqlPart(part: Extract<UIMessagePart, { type: 'tool-execute_sql' }>, state: StreamState): void {
		if (part.state !== 'output-available') {
			return;
		}
		if (part.output.id && part.output.data) {
			state.sqlOutputs.set(part.output.id, { name: part.input.name ?? null, rows: part.output.data });
		}
	}

	private async _resolveSqlOutput(queryId: string, chatId: string, state: StreamState) {
		const sqlOutput = await resolveMattermostSqlOutput({
			queryId,
			sqlOutputs: state.sqlOutputs,
			loadPersisted: async (persistedQueryId) => {
				const persisted = await executeSqlQueries.getExecuteSqlPartByQueryIdInChat(chatId, persistedQueryId);
				if (!persisted?.toolOutput.data) {
					return null;
				}
				return {
					name: persisted.toolInput.name ?? null,
					rows: persisted.toolOutput.data,
				};
			},
		});
		if (!sqlOutput) {
			logger.warn(`Could not resolve SQL output for Mattermost query ${queryId}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { chatId, queryId },
			});
		}
		return sqlOutput;
	}

	private async _handleChartPart(
		part: Extract<UIMessagePart, { type: 'tool-display_chart' }>,
		state: StreamState,
		ctx: MattermostConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedToolCallIds.has(part.toolCallId)) {
			return;
		}
		if (!part.output?.success) {
			return;
		}
		const sqlOutput = await this._resolveSqlOutput(part.input.query_id, ctx.chatId, state);
		if (!sqlOutput) {
			return;
		}
		if (displayChart.isTableInput(part.input)) {
			const table = createMattermostMarkdownTable({ title: part.input.title ?? 'Results', rows: sqlOutput.rows });
			if (!table) {
				return;
			}
			state.renderedToolCallIds.add(part.toolCallId);
			ctx.answerTextPartIndex = -1;
			ctx.bodyParts.push(table);
			await this._editAnswerMessage(ctx);
			return;
		}
		try {
			const displaySettings = await projectQueries.getDisplaySettings(this._config.projectId);
			const png = generateChartImage({
				config: part.input,
				data: sqlOutput.rows,
				dateFormat: displaySettings.dateFormat,
			});
			state.renderedToolCallIds.add(part.toolCallId);
			ctx.answerTextPartIndex = -1;
			await ctx.thread.post({
				markdown: '',
				files: [{ data: png, filename: 'chart.png' }],
			});
			await this._editAnswerMessage(ctx);
		} catch (error) {
			logger.error(`Error rendering or posting Mattermost chart: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			state.renderedToolCallIds.add(part.toolCallId);
			ctx.answerTextPartIndex = -1;
			const chatUrl = new URL(ctx.chatId, this._config.redirectUrl).toString();
			ctx.bodyParts.push(`⚠️ This chart couldn't be rendered in Mattermost. [Open it in nao](${chatUrl}).`);
			try {
				await this._editAnswerMessage(ctx);
			} catch (editError) {
				logger.error(`Error showing Mattermost chart failure: ${String(editError)}`, {
					source: 'system',
					projectId: this._config.projectId,
				});
			}
		}
	}

	private async _handleMapPart(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		state: StreamState,
		ctx: MattermostConversationContext,
	): Promise<void> {
		if (
			part.state !== 'output-available' ||
			!part.output.success ||
			state.renderedToolCallIds.has(part.toolCallId)
		) {
			return;
		}
		state.renderedToolCallIds.add(part.toolCallId);
		const png = await renderMapImage(part, state, this._config.projectId, { toolCallId: part.toolCallId });
		if (!png) {
			await this._pushMapLink(part, ctx);
			return;
		}
		try {
			ctx.answerTextPartIndex = -1;
			await ctx.thread.post({
				markdown: '',
				files: [{ data: png, filename: 'map.png' }],
			});
			await this._editAnswerMessage(ctx);
		} catch (error) {
			logger.error(`Error posting Mattermost map image: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			await this._pushMapLink(part, ctx);
		}
	}

	private async _pushMapLink(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		ctx: MattermostConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available') {
			return;
		}
		try {
			const chatUrl = new URL(ctx.chatId, this._config.redirectUrl).toString();
			ctx.answerTextPartIndex = -1;
			ctx.bodyParts.push(`🗺️ **${part.input.title}**\n\n[View interactive map in nao](${chatUrl})`);
			await this._editAnswerMessage(ctx);
		} catch (error) {
			logger.error(`Error rendering Mattermost map link: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
		}
	}

	private async _handleCollapsibleToolPart(
		part: Extract<UIMessagePart, { toolCallId: string }>,
		state: StreamState,
		ctx: MattermostConversationContext,
	): Promise<void> {
		if (part.state === 'input-streaming') {
			return;
		}
		const entry: ToolCallEntry = {
			type: part.type,
			input: ('input' in part ? part.input : {}) as Record<string, string>,
			toolCallId: part.toolCallId,
		};
		state.toolGroup.set(part.toolCallId, entry);

		if (state.toolGroupBlockIndex === -1) {
			state.toolGroupBlockIndex = ctx.bodyParts.length;
			ctx.bodyParts.push(this._getTextContent(createLiveToolCall(state.toolGroup)));
		} else {
			ctx.bodyParts[state.toolGroupBlockIndex] = this._getTextContent(createLiveToolCall(state.toolGroup));
		}

		if (Date.now() - state.lastUpdateAt >= UPDATE_INTERVAL_MS) {
			await this._editAnswerMessage(ctx);
			state.lastUpdateAt = Date.now();
		}
	}

	private _flushToolGroup(state: StreamState, ctx: MattermostConversationContext): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		ctx.bodyParts[state.toolGroupBlockIndex] = this._getTextContent(createSummaryToolCalls(state.toolGroup));
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
	}

	private async _sendFinalText(ctx: MattermostConversationContext): Promise<void> {
		if (ctx.answerTextPartIndex === -1 || !ctx.convMessage) {
			return;
		}
		await this._editAnswerMessage(ctx);
	}

	private _updateTextBlock(text: string, ctx: MattermostConversationContext): void {
		const markdown = stripAssistantTags(text);
		if (ctx.answerTextPartIndex === -1) {
			ctx.answerTextPartIndex = ctx.bodyParts.length;
			ctx.bodyParts.push(markdown);
		} else {
			ctx.bodyParts[ctx.answerTextPartIndex] = markdown;
		}
	}

	private _getTextContent(element: ReturnType<typeof createLiveToolCall>): string {
		return element.type === 'text' ? element.content : '';
	}

	private _renderBody(ctx: MattermostConversationContext): string {
		return ctx.bodyParts.filter(Boolean).join('\n\n');
	}

	private async _setStopAttachment(postId: string, enabled: boolean): Promise<void> {
		const callbackUrl = this._callbackUrl;
		if (!postId || (enabled && !callbackUrl)) {
			return;
		}
		try {
			await this._patchAnswerPost(postId, (state) => {
				if (state.stopAttached === enabled && state.appliedStopAttached === enabled) {
					return false;
				}
				state.stopAttached = enabled;
				return true;
			});
		} catch (error) {
			logger.warn(`Failed to ${enabled ? 'attach' : 'clear'} Mattermost Stop action: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
		}
	}

	private async _patchAnswerPost(
		postId: string,
		updateState: (state: MattermostAnswerPostState) => boolean | void,
	): Promise<boolean> {
		let patched = false;
		await this._mutateAnswerPost(postId, async () => {
			const state = this._answerPostStates.get(postId);
			if (!state || updateState(state) === false) {
				return;
			}
			const attachments =
				state.stopAttached && this._callbackUrl
					? [
							createMattermostStopAttachment(
								this._callbackUrl,
								createMattermostActionSecret(this._config.projectId, postId),
							),
						]
					: [];
			await patchMattermostAnswerPost({
				baseUrl: this._config.baseUrl,
				botToken: this._config.botToken,
				postId,
				message: state.message,
				baseProps: state.baseProps,
				attachments,
			});
			state.appliedStopAttached = state.stopAttached;
			patched = true;
		});
		return patched;
	}

	private async _mutateAnswerPost(postId: string, mutation: () => Promise<void>): Promise<void> {
		const previous = this._answerPostMutations.get(postId) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(mutation);
		this._answerPostMutations.set(postId, current);
		try {
			await current;
		} finally {
			if (this._answerPostMutations.get(postId) === current) {
				this._answerPostMutations.delete(postId);
			}
		}
	}

	private async _attachAnswerAndSeedReactions(
		ctx: MattermostConversationContext,
		assistantMessageId: string | undefined,
	): Promise<void> {
		if (!ctx.convMessage || !assistantMessageId) {
			return;
		}
		const postId = ctx.convMessage.id;
		const metadata = createMattermostFeedbackMetadata(this._config.projectId, postId, assistantMessageId);
		try {
			const persisted = await this._patchAnswerPost(postId, (state) => {
				state.baseProps = {
					...state.baseProps,
					[MATTERMOST_FEEDBACK_PROP]: metadata,
				};
			});
			if (!persisted) {
				logger.warn(
					'Could not persist Mattermost feedback metadata because the answer post state was missing',
					{
						source: 'system',
						projectId: this._config.projectId,
						context: { postId },
					},
				);
				return;
			}
		} catch (error) {
			logger.warn(`Could not persist Mattermost feedback metadata: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId },
			});
			return;
		}
		const results = await Promise.allSettled([
			this._adapter.addReaction(ctx.thread.id, postId, '+1'),
			this._adapter.addReaction(ctx.thread.id, postId, '-1'),
		]);
		if (results.some((result) => result.status === 'rejected')) {
			logger.warn('Failed to seed one or more Mattermost feedback reactions', {
				source: 'system',
				projectId: this._config.projectId,
			});
		}
	}

	private async _handleReactionFeedback(input: {
		added: boolean;
		emojiName: string;
		isBot: boolean;
		postId: string;
		post?: MattermostPostPlacement;
	}): Promise<void> {
		const feedback = resolveMattermostReactionFeedback(input);
		if (!feedback) {
			return;
		}
		let post = input.post?.id === input.postId ? input.post : null;
		if (!post) {
			try {
				post = await fetchMattermostPost({
					baseUrl: this._config.baseUrl,
					botToken: this._config.botToken,
					postId: input.postId,
				});
			} catch (error) {
				logger.warn(`Could not fetch Mattermost feedback post: ${String(error)}`, {
					source: 'system',
					projectId: this._config.projectId,
					context: { postId: input.postId },
				});
				return;
			}
		}
		if (!post) {
			logger.warn('Ignoring Mattermost feedback reaction because the post was not found', {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId: input.postId },
			});
			return;
		}
		const metadata = verifyMattermostFeedbackMetadata(post.props, this._config.projectId, input.postId);
		if (!metadata.valid) {
			logger.warn(`Ignoring Mattermost feedback reaction because post metadata is ${metadata.reason}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId: input.postId },
			});
			return;
		}
		const belongsToProject = await chatQueries.isAssistantMessageInProject(
			metadata.assistantMessageId,
			this._config.projectId,
		);
		if (!belongsToProject) {
			logger.warn('Ignoring Mattermost feedback reaction because the assistant message is missing or stale', {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId: input.postId, messageId: metadata.assistantMessageId },
			});
			return;
		}
		try {
			if (feedback.action === 'upsert') {
				await feedbackQueries.upsertFeedback({ messageId: metadata.assistantMessageId, vote: feedback.vote });
			} else {
				await feedbackQueries.deleteFeedbackVote(metadata.assistantMessageId, feedback.vote);
			}
		} catch (error) {
			logger.error(`Failed to persist Mattermost feedback: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId: input.postId, messageId: metadata.assistantMessageId },
			});
		}
	}

	private async _resolveThreadChat(threadId: string): Promise<{ id: string; title: string } | null> {
		const chat = await chatQueries.getChatByMattermostThread(threadId);
		if (chat) {
			return chat;
		}
		if (!threadId || !this._adapter.isDM(threadId)) {
			return null;
		}
		const { channelId } = this._adapter.decodeThreadId(threadId);
		const channelThreadId = this._adapter.encodeThreadId({ channelId });
		return chatQueries.getChatByMattermostThread(channelThreadId);
	}
}

class MattermostService {
	private readonly _bots = new Map<string, ProjectMattermostBot>();

	public async startForProject(config: MattermostConfig): Promise<void> {
		const existing = this._bots.get(config.projectId);
		if (existing && !this._configChanged(existing.config, config)) {
			return;
		}
		await this.stopProject(config.projectId);
		const bot = new ProjectMattermostBot(config);
		try {
			await bot.start();
			this._bots.set(config.projectId, bot);
		} catch (error) {
			await bot.stop();
			logger.error(`Failed to start Mattermost for project ${config.projectId}: ${String(error)}`, {
				source: 'system',
				projectId: config.projectId,
			});
			throw error;
		}
	}

	public async syncProject(config: MattermostConfig | null, projectId: string): Promise<void> {
		if (!config) {
			await this.stopProject(projectId);
			return;
		}
		await this.stopProject(projectId);
		await this.startForProject(config);
	}

	public async stopProject(projectId: string): Promise<void> {
		const existing = this._bots.get(projectId);
		if (!existing) {
			return;
		}
		this._bots.delete(projectId);
		try {
			await existing.stop();
		} catch (error) {
			logger.error(`Failed to stop Mattermost for project ${projectId}: ${String(error)}`, {
				source: 'system',
				projectId,
			});
		}
	}

	public async startForAllProjects(): Promise<void> {
		try {
			const configs = await listProjectsWithMattermostEnabled();
			for (const config of configs) {
				try {
					await this.startForProject(config);
				} catch {
					continue;
				}
			}
		} catch (error) {
			logger.error(`Failed to enumerate Mattermost projects: ${String(error)}`, {
				source: 'system',
			});
		}
	}

	public getAdapter(projectId: string): MattermostAdapter | null {
		return this._bots.get(projectId)?.adapter ?? null;
	}

	private _configChanged(current: MattermostConfig, next: MattermostConfig): boolean {
		return (
			current.baseUrl !== next.baseUrl ||
			current.botToken !== next.botToken ||
			current.redirectUrl !== next.redirectUrl ||
			current.modelSelection?.provider !== next.modelSelection?.provider ||
			current.modelSelection?.modelId !== next.modelSelection?.modelId ||
			current.interactiveButtonsEnabled !== next.interactiveButtonsEnabled ||
			current.callbackUrl !== next.callbackUrl
		);
	}
}

function createMattermostLogger(projectId: string, prefix = 'mattermost'): ChatLogger {
	return {
		child(childPrefix: string) {
			return createMattermostLogger(projectId, `${prefix}:${childPrefix}`);
		},
		debug(message: string) {
			void message;
		},
		info(message: string) {
			logger.info(`${prefix} ${message}`, { source: 'system', projectId });
		},
		warn(message: string) {
			logger.warn(`${prefix} ${message}`, { source: 'system', projectId });
		},
		error(message: string) {
			logger.error(`${prefix} ${message}`, { source: 'system', projectId });
		},
	};
}

export const mattermostService = new MattermostService();
