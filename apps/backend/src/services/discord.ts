import { createDiscordAdapter, type DiscordAdapter } from '@chat-adapter/discord';
import { createMemoryState } from '@chat-adapter/state-memory';
import { stripAssistantTags } from '@nao/shared';
import { isQueryResultPart, type QueryResultPartType } from '@nao/shared/execute-sql-parts';
import { displayChart } from '@nao/shared/tools';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { type AdapterPostableMessage, Chat, type Logger as ChatLogger, Message, type SentMessage, Thread } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import type { User } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { type DiscordConfig, listProjectsWithDiscordEnabled } from '../queries/project-discord-config.queries';
import * as discordLinkQueries from '../queries/project-discord-link.queries';
import { getUser, getUserByMessagingProviderCode } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { logger } from '../utils/logger';
import {
	createDiscordAnswerMessage,
	createLiveToolCall,
	createSummaryToolCalls,
	EXCLUDED_TOOLS,
	formatClarificationText,
	formatMessagingError,
	renderMapImage,
} from '../utils/messaging-provider';
import { agentService } from './agent';
import {
	buildDiscordAnswerPostable,
	cacheDiscordEmail,
	canUseDiscordInProject,
	createDiscordAnswerAttachment,
	createDiscordMarkdownTable,
	DISCORD_ATTACHMENT_NOTICE,
	DISCORD_POST_MAX_LENGTH,
	DISCORD_THUMBS_DOWN,
	DISCORD_THUMBS_UP,
	type DiscordAuthorType,
	type DiscordEmailCache,
	fetchDiscordUserEmail,
	getDiscordLoginCommandForUnlinkedUser,
	hasExplicitDiscordMention,
	resolveDiscordAccount,
	resolveDiscordReactionFeedback,
	resolveDiscordSqlOutput,
	shouldHandleDiscordMessage,
	truncateDiscordMarkdown,
} from './discord-helpers';
import { posthog, PostHogEvent } from './posthog';

/** Matches Slack's 200ms cadence; Discord rate-limits per-channel edits. */
const UPDATE_INTERVAL_MS = 200;

/** Node clamps setTimeout delays above 2^31-1 to 1ms, so this is the longest "run until stopped". */
const GATEWAY_LISTENER_DURATION_MS = 2_147_483_647;

/** Delay before starting the listener again after a failed restart. */
const GATEWAY_RESTART_RETRY_MS = 30_000;

type DiscordConversationContext = Omit<ConversationContext, 'blocks' | 'textBlockIndex'> & {
	answerTextPartIndex: number;
	bodyParts: string[];
	/** Persisted id of the assistant message this turn produced, once the stream settles. */
	answerMessageId?: string;
};

type DiscordAnswerMessageState = {
	sentMessage: SentMessage;
	message: string;
	stopAttached: boolean;
	appliedStopAttached: boolean;
};

class ProjectDiscordBot {
	private readonly _bot: Chat;
	private readonly _adapter: DiscordAdapter;
	private readonly _emailByDiscordId: DiscordEmailCache = new Map();
	private readonly _answerPostMutations = new Map<string, Promise<void>>();
	private readonly _answerPostStates = new Map<string, DiscordAnswerMessageState>();
	private _gatewayAbort: AbortController | null = null;
	private _gatewayRetryTimer: NodeJS.Timeout | null = null;

	constructor(private readonly _config: DiscordConfig) {
		this._adapter = createDiscordAdapter({
			botToken: _config.botToken,
			applicationId: _config.applicationId,
			publicKey: _config.publicKey,
			mentionRoleIds: _config.mentionRoleIds,
			respondToChannelIds: _config.respondToChannelIds,
		});
		this._bot = new Chat({
			userName: 'nao',
			adapters: { discord: this._adapter },
			logger: createDiscordLogger(_config.projectId),
			state: createMemoryState(),
		});
		this._registerHandlers();
	}

	public get config(): DiscordConfig {
		return this._config;
	}

	public get adapter(): DiscordAdapter {
		return this._adapter;
	}

	public async start(): Promise<void> {
		await this._bot.initialize();
		await this._startGatewayListener();
	}

	public async stop(): Promise<void> {
		// The gateway listener holds the only live connection. Interactions arrive as stateless HTTP
		// requests, but a plain message only ever arrives over the gateway.
		this._gatewayAbort?.abort();
		this._gatewayAbort = null;
		if (this._gatewayRetryTimer) {
			clearTimeout(this._gatewayRetryTimer);
			this._gatewayRetryTimer = null;
		}
		this._answerPostStates.clear();
		this._answerPostMutations.clear();
	}

	/**
	 * Plain Discord messages are delivered over the gateway only -- the HTTP webhook carries
	 * interactions (slash commands, buttons), never a normal message. Without a listener the bot
	 * looks healthy in the UI and silently ignores every mention. No webhookUrl is passed, so the
	 * adapter processes messages in-process rather than forwarding them to an HTTP endpoint.
	 */
	private async _startGatewayListener(): Promise<void> {
		const abort = new AbortController();
		this._gatewayAbort = abort;
		const response = await this._adapter.startGatewayListener(
			{
				waitUntil: (task: Promise<unknown>) => {
					void task.then(
						() => this._restartGatewayListener(abort),
						(error: unknown) => {
							logger.error(`Discord gateway listener stopped: ${String(error)}`, {
								source: 'system',
								projectId: this._config.projectId,
							});
						},
					);
				},
			},
			GATEWAY_LISTENER_DURATION_MS,
			abort.signal,
		);
		if (!response.ok) {
			throw new Error(
				`Could not start the Discord gateway listener: ${response.status} ${await response.text()}`,
			);
		}
	}

	/**
	 * The adapter listens for its duration argument and then returns, so the listener has to be
	 * started again when it ends. Without this the bot stays in _bots looking healthy while every
	 * plain message is dropped, because only a config change or a process restart would start it.
	 */
	private async _restartGatewayListener(previous: AbortController): Promise<void> {
		if (this._gatewayAbort !== previous || previous.signal.aborted) {
			return;
		}
		logger.warn('Discord gateway listener ended; restarting it', {
			source: 'system',
			projectId: this._config.projectId,
		});
		try {
			await this._startGatewayListener();
		} catch (error) {
			logger.error(`Could not restart the Discord gateway listener: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			this._scheduleGatewayRestart();
		}
	}

	/**
	 * ponytail: a fixed cadence, not backoff -- each attempt is a single API call and a start that
	 * fails is usually the network, not rate limiting. The stop path clears the timer; move to
	 * backoff if Discord ever starts rejecting the start call.
	 */
	private _scheduleGatewayRestart(): void {
		const abort = this._gatewayAbort;
		if (this._gatewayRetryTimer || !abort || abort.signal.aborted) {
			return;
		}
		this._gatewayRetryTimer = setTimeout(() => {
			this._gatewayRetryTimer = null;
			void this._restartGatewayListener(abort);
		}, GATEWAY_RESTART_RETRY_MS);
		// Never hold the process open for a retry.
		this._gatewayRetryTimer.unref?.();
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
			const threadId = event.thread?.id || event.threadId || '';
			const actionChat = await this._resolveThreadChat(threadId);
			if (actionChat) {
				agentService.get(actionChat.id)?.stop();
			}
			if (event.messageId) {
				await this._setStopAttachment(event.messageId, false);
			}
		});

		this._bot.onReaction(async (event) => {
			await this._handleReactionFeedback({
				added: event.added,
				emojiName: event.emoji.name,
				isBot: event.user.isMe || event.user.isBot === true,
				postId: event.messageId,
			});
		});
	}

	private async _shouldHandleMessage(thread: Thread, message: Message): Promise<boolean> {
		const authorType = this._resolveMessageAuthorType(message);
		const isDirectMessage = this._adapter.isDM(thread.id);
		const isThreadReply = Boolean(this._adapter.decodeThreadId(thread.id).threadId);
		const hasRawMention = hasExplicitDiscordMention(message.raw, {
			userId: this._adapter.botUserId,
			mentionRoleIds: this._config.mentionRoleIds,
		});
		const isExplicitMention = hasRawMention || (!isDirectMessage && message.isMention === true);
		const needsThreadContext = authorType === 'human' && !isExplicitMention && (!isDirectMessage || isThreadReply);
		const threadContext = needsThreadContext
			? await this._resolveMessageThreadContext(thread)
			: { hasExistingChat: false };
		return shouldHandleDiscordMessage({
			isDirectMessage,
			isThreadReply,
			isMention: isExplicitMention,
			...threadContext,
			authorType,
			isOwnMessage: message.author.isMe,
		});
	}

	private async _resolveMessageThreadContext(thread: Thread): Promise<{ hasExistingChat: boolean }> {
		const existingChat = await chatQueries.getChatByDiscordThread(thread.id);
		return { hasExistingChat: Boolean(existingChat) };
	}

	private _resolveMessageAuthorType(message: Message): DiscordAuthorType {
		if (message.author.isMe) {
			return 'unknown';
		}
		if (message.author.isBot === true) {
			return 'bot';
		}
		if (message.author.isBot === false) {
			return 'human';
		}
		return 'unknown';
	}

	private async _handleMessage(thread: Thread, message: Message): Promise<void> {
		message.text = message.text.replace(/<@[!&]?\d+>\s*/g, '').trim();
		const linkedUser = await this._resolveLinkedUser(message);
		const loginCommand = getDiscordLoginCommandForUnlinkedUser(message.text, Boolean(linkedUser));
		if (loginCommand) {
			await this._handleLoginCommand(thread, message, loginCommand.code);
			return;
		}
		await this._handleWorkflow(thread, message);
	}

	private async _handleWorkflow(thread: Thread, userMessage: Message): Promise<void> {
		const ctx: DiscordConversationContext = {
			thread,
			userMessage,
			user: null,
			chatId: '',
			convMessage: null,
			answerTextPartIndex: -1,
			bodyParts: [],
			answerMessageId: undefined,
			textBlockCount: 0,
			isNewChat: false,
			modelId: undefined,
			timezone: undefined,
		};

		try {
			await this._validateUserAccess(ctx);
			ctx.convMessage = await ctx.thread.post('✨ nao is answering...');
			this._answerPostStates.set(ctx.convMessage.id, {
				sentMessage: ctx.convMessage,
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

	private async _validateUserAccess(ctx: DiscordConversationContext): Promise<void> {
		await this._getUser(ctx);
		await this._checkUserBelongsToProject(ctx);
	}

	private async _handleLoginCommand(thread: Thread, message: Message, code: string): Promise<void> {
		const discordId = this._getDiscordId(message);
		if (!discordId) {
			await thread.post('❌ Could not retrieve your Discord identity.');
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

		// A code proves the account, not that it belongs in this project. Linking a user who cannot
		// use it here would deny every message afterwards, and the author cannot relink because the
		// parser ignores `login` from an already-linked Discord user.
		const role = await projectQueries.getUserRoleInProject(this._config.projectId, user.id);
		if (!canUseDiscordInProject(role)) {
			await thread.post('❌ That nao account does not have access to this project. Ask an administrator.');
			return;
		}

		await discordLinkQueries.upsertLinkedDiscordUser({
			projectId: this._config.projectId,
			discordUserId: discordId,
			userId: user.id,
		});
		cacheDiscordEmail(this._emailByDiscordId, discordId, user.email);
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	private _getDiscordId(message: Message): string | null {
		return message.author.userId || null;
	}

	private async _getUser(ctx: DiscordConversationContext): Promise<void> {
		const discordId = this._getDiscordId(ctx.userMessage);
		if (!discordId) {
			throw new Error('Could not retrieve user identity from Discord');
		}

		const user = (await this._resolveLinkedUser(ctx.userMessage)) ?? (await this._resolveFallbackUser());
		if (!user) {
			await ctx.thread.post(
				'👋 I could not match your Discord account. Send `login <your-code>` to link manually. Find your code in project settings.',
			);
			throw new Error('User not linked');
		}
		ctx.user = user;
	}

	/**
	 * Discord never exposes member emails, so no member can link automatically. A community server
	 * can nominate one nao user as the shared identity, and messages from unlinked members are then
	 * answered as that user. Per-person attribution is deliberately given up -- that is the trade.
	 */
	private async _resolveFallbackUser(): Promise<User | null> {
		const fallbackUserId = this._config.fallbackUserId;
		if (!fallbackUserId) {
			return null;
		}
		return getUser({ id: fallbackUserId });
	}

	private async _resolveLinkedUser(message: Message): Promise<User | null> {
		const discordId = this._getDiscordId(message);
		if (!discordId) {
			return null;
		}
		try {
			// The persisted link first: it is the only thing that survives a bot restart, since
			// Discord cannot supply the member's email a second time.
			const link = await discordLinkQueries.getLinkedDiscordUser(this._config.projectId, discordId);
			if (link) {
				const linkedUser = await getUser({ id: link.userId });
				if (linkedUser) {
					cacheDiscordEmail(this._emailByDiscordId, discordId, linkedUser.email);
					return linkedUser;
				}
			}
			return await resolveDiscordAccount({
				userId: discordId,
				emailCache: this._emailByDiscordId,
				fetchEmail: () => fetchDiscordUserEmail({ adapter: this._adapter, userId: discordId }),
				findUser: (email) => getUser({ email }),
			});
		} catch (error) {
			logger.warn(`Failed to resolve Discord user email: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			return null;
		}
	}

	private async _checkUserBelongsToProject(ctx: DiscordConversationContext): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this._config.projectId, ctx.user!.id);
		if (!canUseDiscordInProject(role)) {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(ctx: DiscordConversationContext): Promise<void> {
		const text = ctx.userMessage.text;
		const existingChat = await chatQueries.getChatByDiscordThread(ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				senderUserId: ctx.user!.id,
				source: 'discord',
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
				discordThreadId: ctx.thread.id,
			},
			{ text, source: 'discord' },
		);
		ctx.chatId = createdChat.id;
		ctx.isNewChat = true;
	}

	private async _handleStreamAgent(chat: UIChat, ctx: DiscordConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const answerPostId = ctx.convMessage?.id;
		try {
			if (answerPostId) {
				await this._setStopAttachment(answerPostId, true);
			}
			await this._readStreamAndUpdateMessage(stream, ctx);

			const chatUrl = new URL(ctx.chatId, this._config.redirectUrl).toString();
			const overflowAttached = await this._attachAnswerOverflow(ctx, chatUrl);
			await this._editAnswerMessageFailSoft(ctx, chatUrl, overflowAttached);
			if (answerPostId) {
				await this._setStopAttachment(answerPostId, false);
			}
			await this._recordAnswerMessage(answerPostId, ctx.answerMessageId);
			await this._seedFeedbackReactions(ctx);

			posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
				project_id: this._config.projectId,
				chat_id: ctx.chatId,
				model_id: ctx.modelId,
				is_new_chat: ctx.isNewChat,
				source: 'discord',
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
		ctx: DiscordConversationContext,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this._config.projectId },
			this._config.modelSelection,
			{ supportsCustomCharts: false },
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'discord', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: DiscordConversationContext,
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
				if (isQueryResultPart(sqlPart)) {
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
		ctx.answerMessageId = lastMessage?.id;
		return { ...state, lastMessage };
	}

	private async _editAnswerMessage(
		ctx: DiscordConversationContext,
		chatUrl?: string,
		overflowAttached = false,
	): Promise<void> {
		const answerMessage = ctx.convMessage;
		if (!answerMessage) {
			return;
		}
		// Community servers can drop the footer link: it points at a UI those members may not have access to.
		const answerUrl = this._config.hideAnswerLink ? undefined : chatUrl;
		const body = truncateDiscordMarkdown(
			this._renderBody(ctx),
			this._answerPostBudget(answerUrl),
			overflowAttached ? DISCORD_ATTACHMENT_NOTICE : undefined,
		);
		const message = createDiscordAnswerMessage(body, answerUrl).markdown;
		await this._patchAnswerPost(answerMessage.id, (state) => {
			state.message = message;
		});
	}

	private async _editAnswerMessageFailSoft(
		ctx: DiscordConversationContext,
		chatUrl?: string,
		overflowAttached = false,
	): Promise<boolean> {
		try {
			await this._editAnswerMessage(ctx, chatUrl, overflowAttached);
			return true;
		} catch (error) {
			logger.warn(`Failed to update Discord answer message: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			return false;
		}
	}

	/** What the answer post holds: Discord's content cap minus the footer link it has to carry. */
	private _answerPostBudget(answerUrl: string | undefined): number {
		const linkLength = answerUrl ? createDiscordAnswerMessage('', answerUrl).markdown.length + 2 : 0;
		return Math.max(DISCORD_POST_MAX_LENGTH - linkLength, 0);
	}

	/**
	 * Uploads the whole answer when the post had to truncate it. Called ONCE, after the stream ends --
	 * the streaming edits would otherwise post a fresh copy on every tool tick. Fail-soft: the post
	 * already carries the nao link, so a failed upload costs the reader nothing beyond today's output.
	 */
	private async _attachAnswerOverflow(ctx: DiscordConversationContext, chatUrl?: string): Promise<boolean> {
		// No answer post means the body is not on screen either; a bare file would be the only trace.
		if (!ctx.convMessage) {
			return false;
		}
		const answerUrl = this._config.hideAnswerLink ? undefined : chatUrl;
		const attachment = createDiscordAnswerAttachment(this._renderBody(ctx), this._answerPostBudget(answerUrl));
		if (!attachment) {
			return false;
		}
		try {
			// Captioned, not bare: the "attached below" notice is a separate edit that can fail, and a
			// bare answer.md under a post still saying "open the full result in nao" reads as a stray
			// file. The caption has to stand on its own.
			await ctx.thread.post({
				markdown: "📄 **The full answer** — the post above was truncated to fit Discord's limit.",
				files: [attachment],
			});
			return true;
		} catch (error) {
			logger.warn(`Failed to upload the full Discord answer: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			return false;
		}
	}

	private _handleClarificationPart(
		part: Extract<UIMessagePart, { type: 'tool-clarification' }>,
		state: StreamState,
		ctx: DiscordConversationContext,
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
		ctx: DiscordConversationContext,
	): Promise<void> {
		this._updateTextBlock(part.text, ctx);
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS || !part.text) {
			return;
		}
		if (await this._editAnswerMessageFailSoft(ctx)) {
			state.lastUpdateAt = Date.now();
		}
	}

	private _handleSqlPart(part: Extract<UIMessagePart, { type: QueryResultPartType }>, state: StreamState): void {
		if (part.state !== 'output-available') {
			return;
		}
		if (part.output.id && part.output.data) {
			state.sqlOutputs.set(part.output.id, { name: part.input.name ?? null, rows: part.output.data });
		}
	}

	private async _resolveSqlOutput(queryId: string, chatId: string, state: StreamState) {
		const sqlOutput = await resolveDiscordSqlOutput({
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
			logger.warn(`Could not resolve SQL output for Discord query ${queryId}`, {
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
		ctx: DiscordConversationContext,
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
			const table = createDiscordMarkdownTable({ title: part.input.title ?? 'Results', rows: sqlOutput.rows });
			if (!table) {
				return;
			}
			state.renderedToolCallIds.add(part.toolCallId);
			ctx.answerTextPartIndex = -1;
			ctx.bodyParts.push(table);
			await this._editAnswerMessageFailSoft(ctx);
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
			logger.error(`Error rendering or posting Discord chart: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			state.renderedToolCallIds.add(part.toolCallId);
			ctx.answerTextPartIndex = -1;
			const chatUrl = new URL(ctx.chatId, this._config.redirectUrl).toString();
			ctx.bodyParts.push(`⚠️ This chart couldn't be rendered in Discord. [Open it in nao](${chatUrl}).`);
			try {
				await this._editAnswerMessage(ctx);
			} catch (editError) {
				logger.error(`Error showing Discord chart failure: ${String(editError)}`, {
					source: 'system',
					projectId: this._config.projectId,
				});
			}
		}
	}

	private async _handleMapPart(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		state: StreamState,
		ctx: DiscordConversationContext,
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
			logger.error(`Error posting Discord map image: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			await this._pushMapLink(part, ctx);
		}
	}

	private async _pushMapLink(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		ctx: DiscordConversationContext,
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
			logger.error(`Error rendering Discord map link: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
		}
	}

	private async _handleCollapsibleToolPart(
		part: Extract<UIMessagePart, { toolCallId: string }>,
		state: StreamState,
		ctx: DiscordConversationContext,
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
			if (await this._editAnswerMessageFailSoft(ctx)) {
				state.lastUpdateAt = Date.now();
			}
		}
	}

	private _flushToolGroup(state: StreamState, ctx: DiscordConversationContext): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		ctx.bodyParts[state.toolGroupBlockIndex] = this._getTextContent(createSummaryToolCalls(state.toolGroup));
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
	}

	private async _sendFinalText(ctx: DiscordConversationContext): Promise<void> {
		if (ctx.answerTextPartIndex === -1 || !ctx.convMessage) {
			return;
		}
		await this._editAnswerMessageFailSoft(ctx);
	}

	private _updateTextBlock(text: string, ctx: DiscordConversationContext): void {
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

	private _renderBody(ctx: DiscordConversationContext): string {
		return ctx.bodyParts.filter(Boolean).join('\n\n');
	}

	/** The Stop action rides along with the answer message; Discord interactions carry no callback secret. */
	private _buildAnswerPostable(state: DiscordAnswerMessageState): AdapterPostableMessage {
		return buildDiscordAnswerPostable(state.message, state.stopAttached);
	}

	private async _setStopAttachment(postId: string, enabled: boolean): Promise<void> {
		if (!postId) {
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
			logger.warn(`Failed to ${enabled ? 'attach' : 'clear'} Discord Stop action: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
		}
	}

	private async _patchAnswerPost(
		postId: string,
		updateState: (state: DiscordAnswerMessageState) => boolean | void,
	): Promise<boolean> {
		let patched = false;
		await this._mutateAnswerPost(postId, async () => {
			const state = this._answerPostStates.get(postId);
			if (!state || updateState(state) === false) {
				return;
			}
			await state.sentMessage.edit(this._buildAnswerPostable(state));
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

	private async _seedFeedbackReactions(ctx: DiscordConversationContext): Promise<void> {
		const message = ctx.convMessage;
		if (!message) {
			return;
		}
		const results = await Promise.allSettled([
			this._adapter.addReaction(ctx.thread.id, message.id, DISCORD_THUMBS_UP),
			this._adapter.addReaction(ctx.thread.id, message.id, DISCORD_THUMBS_DOWN),
		]);
		if (results.some((result) => result.status === 'rejected')) {
			logger.warn('Failed to seed one or more Discord feedback reactions', {
				source: 'system',
				projectId: this._config.projectId,
			});
		}
	}

	/**
	 * Reactions can land on any answer in a Discord thread, so remember which assistant message a
	 * posted answer carries instead of assuming the thread's newest one. Best effort: a failure here
	 * must not fail the answer that has already been rendered.
	 */
	private async _recordAnswerMessage(
		postId: string | undefined,
		assistantMessageId: string | undefined,
	): Promise<void> {
		if (!postId || !assistantMessageId) {
			return;
		}
		try {
			await chatQueries.attachDiscordMessageId(assistantMessageId, postId);
		} catch (error) {
			logger.warn(`Could not persist the Discord feedback message link: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId, assistantMessageId },
			});
		}
	}

	private async _handleReactionFeedback(input: {
		added: boolean;
		emojiName: string;
		isBot: boolean;
		postId: string;
	}): Promise<void> {
		const feedback = resolveDiscordReactionFeedback(input);
		if (!feedback || !input.postId) {
			return;
		}
		const messageId = await chatQueries.getAssistantMessageIdByDiscordMessage(input.postId, this._config.projectId);
		if (!messageId) {
			logger.warn('Ignoring Discord feedback reaction because the message is not an answer in this project', {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId: input.postId },
			});
			return;
		}
		try {
			if (feedback.action === 'upsert') {
				await feedbackQueries.upsertFeedback({ messageId, vote: feedback.vote });
			} else {
				await feedbackQueries.deleteFeedbackVote(messageId, feedback.vote);
			}
		} catch (error) {
			logger.error(`Failed to persist Discord feedback: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { messageId },
			});
		}
	}

	private async _resolveThreadChat(threadId: string): Promise<{ id: string; title: string } | null> {
		const chat = await chatQueries.getChatByDiscordThread(threadId);
		return chat ?? null;
	}
}

class DiscordService {
	private readonly _bots = new Map<string, ProjectDiscordBot>();

	public async startForProject(config: DiscordConfig): Promise<void> {
		const existing = this._bots.get(config.projectId);
		if (existing && !this._configChanged(existing.config, config)) {
			return;
		}
		await this.stopProject(config.projectId);
		const bot = new ProjectDiscordBot(config);
		try {
			await bot.start();
			this._bots.set(config.projectId, bot);
		} catch (error) {
			await bot.stop();
			logger.error(`Failed to start Discord for project ${config.projectId}: ${String(error)}`, {
				source: 'system',
				projectId: config.projectId,
			});
			throw error;
		}
	}

	public async syncProject(config: DiscordConfig | null, projectId: string): Promise<void> {
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
			logger.error(`Failed to stop Discord for project ${projectId}: ${String(error)}`, {
				source: 'system',
				projectId,
			});
		}
	}

	public async startForAllProjects(): Promise<void> {
		try {
			const configs = await listProjectsWithDiscordEnabled();
			for (const config of configs) {
				try {
					await this.startForProject(config);
				} catch {
					continue;
				}
			}
		} catch (error) {
			logger.error(`Failed to enumerate Discord projects: ${String(error)}`, {
				source: 'system',
			});
		}
	}

	public getAdapter(projectId: string): DiscordAdapter | null {
		return this._bots.get(projectId)?.adapter ?? null;
	}

	private _configChanged(current: DiscordConfig, next: DiscordConfig): boolean {
		return (
			current.botToken !== next.botToken ||
			current.applicationId !== next.applicationId ||
			current.publicKey !== next.publicKey ||
			current.redirectUrl !== next.redirectUrl ||
			current.modelSelection?.provider !== next.modelSelection?.provider ||
			current.modelSelection?.modelId !== next.modelSelection?.modelId ||
			!isSameStringArray(current.mentionRoleIds, next.mentionRoleIds) ||
			!isSameStringArray(current.respondToChannelIds, next.respondToChannelIds) ||
			current.fallbackUserId !== next.fallbackUserId ||
			current.hideAnswerLink !== next.hideAnswerLink
		);
	}
}

function isSameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createDiscordLogger(projectId: string, prefix = 'discord'): ChatLogger {
	return {
		child(childPrefix: string) {
			return createDiscordLogger(projectId, `${prefix}:${childPrefix}`);
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

export const discordService = new DiscordService();
