import { createDiscordAdapter, type DiscordAdapter } from '@chat-adapter/discord';
import { createMemoryState } from '@chat-adapter/state-memory';
import { stripAssistantTags } from '@nao/shared';
import { isQueryResultPart, type QueryResultPartType } from '@nao/shared/execute-sql-parts';
import { displayChart } from '@nao/shared/tools';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Chat, type Logger as ChatLogger, Message, type SentMessage, Thread } from 'chat';

import { messagingAgent } from '../agents/profiles/messaging';
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
import { DISCORD_LINK_TOKEN_TTL_MINUTES, generateDiscordLinkToken } from '../utils/discord-link-token';
import { logger } from '../utils/logger';
import {
	createMarkdownTable,
	getLoginCommandForUnlinkedUser,
	type MessageAuthorType,
	resolveSqlOutput,
	shouldHandleMessage,
	truncateMarkdown,
} from '../utils/markdown-messaging';
import {
	createLiveToolCall,
	createMarkdownAnswerMessage,
	createSummaryToolCalls,
	escapeMarkdownText,
	EXCLUDED_TOOLS,
	formatClarificationText,
	formatMessagingError,
	renderMapImage,
} from '../utils/messaging-provider';
import { agentService } from './agent';
import { getAppName } from './branding.service';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import {
	buildDiscordAnswerPayload,
	canUseDiscordInProject,
	createDiscordAnswerAttachment,
	DISCORD_ANSWERING_PLACEHOLDER,
	DISCORD_ATTACHMENT_NOTICE,
	DISCORD_LOGIN_CODE_PROMPT,
	DISCORD_POST_MAX_LENGTH,
	DISCORD_THUMBS_DOWN,
	DISCORD_THUMBS_UP,
	editDiscordMessage,
	formatDiscordTable,
	hasExplicitDiscordMention,
	resolveDiscordReactionFeedback,
} from './discord-helpers';
import { assertMessagingUserCloudBillingAccess } from './messaging-cloud-billing-access';

/** Matches Slack's 200ms cadence; Discord rate-limits per-channel edits. */
const UPDATE_INTERVAL_MS = 200;

/** Node clamps setTimeout delays above 2^31-1 to 1ms, so this is the longest "run until stopped". */
const GATEWAY_LISTENER_DURATION_MS = 2_147_483_647;

const GATEWAY_RESTART_RETRY_MS = 30_000;

/** Discord allows one reaction write per 250ms per channel and the adapter doesn't retry on 429. */
const REACTION_SEED_INTERVAL_MS = 300;

type DiscordConversationContext = Omit<ConversationContext, 'blocks' | 'textBlockIndex'> & {
	answerTextPartIndex: number;
	bodyParts: string[];
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
	 * Plain messages only arrive over the gateway; the HTTP webhook carries interactions only.
	 * No webhookUrl is passed so the adapter processes gateway events in-process.
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

	private _scheduleGatewayRestart(): void {
		const abort = this._gatewayAbort;
		if (this._gatewayRetryTimer || !abort || abort.signal.aborted) {
			return;
		}
		this._gatewayRetryTimer = setTimeout(() => {
			this._gatewayRetryTimer = null;
			void this._restartGatewayListener(abort);
		}, GATEWAY_RESTART_RETRY_MS);
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
			const actionChat = await chatQueries.getChatByDiscordThread(event.thread?.id || event.threadId || '');
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
		const hasExistingChat = needsThreadContext && Boolean(await chatQueries.getChatByDiscordThread(thread.id));
		return shouldHandleMessage({
			isDirectMessage,
			isThreadReply,
			isMention: isExplicitMention,
			hasExistingChat,
			authorType,
			isOwnMessage: message.author.isMe,
		});
	}

	private _resolveMessageAuthorType(message: Message): MessageAuthorType {
		if (message.author.isBot === true) {
			return 'bot';
		}
		return message.author.isBot === false ? 'human' : 'unknown';
	}

	private async _handleMessage(thread: Thread, message: Message): Promise<void> {
		message.text = message.text.replace(/<@[!&]?\d+>\s*/g, '').trim();
		const linkedUser = await this._resolveLinkedUser(message);
		const loginCommand = getLoginCommandForUnlinkedUser(message.text, Boolean(linkedUser));
		if (loginCommand) {
			await this._handleLoginCommand(thread, message, loginCommand.code);
			return;
		}
		await this._handleWorkflow(thread, message, linkedUser ?? (await this._resolveFallbackUser()));
	}

	private async _handleWorkflow(thread: Thread, userMessage: Message, user: User | null): Promise<void> {
		const ctx: DiscordConversationContext = {
			thread,
			userMessage,
			user,
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
			if (!(await this._validateUserAccess(ctx))) {
				return;
			}
			if (
				!(await assertMessagingUserCloudBillingAccess(this._config.projectId, ctx.user!.id, (message) =>
					ctx.thread.post(message),
				))
			) {
				return;
			}
			await assertProjectCloudBillingAccess(this._config.projectId);
			ctx.convMessage = await ctx.thread.post(DISCORD_ANSWERING_PLACEHOLDER);
			this._answerPostStates.set(ctx.convMessage.id, {
				sentMessage: ctx.convMessage,
				message: DISCORD_ANSWERING_PLACEHOLDER,
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
			const errorMessage = formatMessagingError(error);
			if (!ctx.convMessage) {
				await ctx.thread.post(errorMessage);
				return;
			}
			ctx.bodyParts = [errorMessage];
			await this._editAnswerMessage(ctx);
		} finally {
			if (ctx.convMessage) {
				await this._setStopAttachment(ctx.convMessage.id, false);
				this._answerPostStates.delete(ctx.convMessage.id);
				this._answerPostMutations.delete(ctx.convMessage.id);
			}
		}
	}

	private async _validateUserAccess(ctx: DiscordConversationContext): Promise<boolean> {
		if (!ctx.user) {
			await this._promptAccountLink(ctx.thread, ctx.userMessage.author);
			return false;
		}
		const role = await projectQueries.getUserRoleInProject(this._config.projectId, ctx.user.id);
		if (!canUseDiscordInProject(role)) {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			return false;
		}
		return true;
	}

	public async sendDirectMessage(discordUserId: string, text: string): Promise<boolean> {
		try {
			const directMessageThreadId = await this._adapter.openDM(discordUserId);
			await this._adapter.postMessage(directMessageThreadId, text);
			return true;
		} catch (error) {
			logger.warn(`Could not send a Discord direct message: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			return false;
		}
	}

	private async _promptAccountLink(thread: Thread, author: Message['author']): Promise<void> {
		if (!author.userId) {
			await thread.post(DISCORD_LOGIN_CODE_PROMPT);
			return;
		}

		const linkMessage = await this._buildAccountLinkMessage(author);
		if (this._adapter.isDM(thread.id)) {
			await thread.post(linkMessage);
			return;
		}

		const sent = await this.sendDirectMessage(author.userId, linkMessage);
		await thread.post(sent ? '👋 I sent you a direct message to connect your account.' : DISCORD_LOGIN_CODE_PROMPT);
	}

	private async _buildAccountLinkMessage(author: Message['author']): Promise<string> {
		const token = generateDiscordLinkToken({
			projectId: this._config.projectId,
			discordUserId: author.userId,
			discordUserName: author.userName || author.fullName,
		});
		const linkUrl = new URL('discord-link', this._config.redirectUrl);
		linkUrl.searchParams.set('token', token);
		const appName = escapeMarkdownText(await getAppName());
		return `🔗 [Connect your Discord account to ${appName}](${linkUrl.toString()}), then ask your question again. This link expires in ${DISCORD_LINK_TOKEN_TTL_MINUTES} minutes.`;
	}

	private async _handleLoginCommand(thread: Thread, message: Message, code: string): Promise<void> {
		const discordId = message.author.userId;
		if (!discordId) {
			await thread.post('❌ Could not retrieve your Discord identity.');
			return;
		}

		const user = await getUserByMessagingProviderCode(code);
		if (!user) {
			await thread.post('❌ Invalid linking code. Check your code in the project settings.');
			return;
		}

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
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	/** Discord never exposes member emails, so a persisted link (magic link or `login <code>`) is the only way to match a user. */
	private async _resolveLinkedUser(message: Message): Promise<User | null> {
		const discordId = message.author.userId;
		if (!discordId) {
			return null;
		}
		const link = await discordLinkQueries.getLinkedDiscordUser(this._config.projectId, discordId);
		return link ? getUser({ id: link.userId }) : null;
	}

	private async _resolveFallbackUser(): Promise<User | null> {
		const fallbackUserId = this._config.fallbackUserId;
		return fallbackUserId ? getUser({ id: fallbackUserId }) : null;
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
			const { lastMessage } = await this._readStreamAndUpdateMessage(stream, ctx);

			const answerUrl = this._config.hideAnswerLink ? undefined : this._getChatUrl(ctx);
			const overflowAttached = await this._attachAnswerOverflow(ctx, answerUrl);
			await this._editAnswerMessageFailSoft(ctx, answerUrl, overflowAttached);
			if (answerPostId) {
				await this._setStopAttachment(answerPostId, false);
			}
			await this._attachAnswerAndSeedReactions(ctx, lastMessage?.id);
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
			messagingAgent('discord'),
			{ billingAccessVerifiedProjectId: this._config.projectId },
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, {
			timezone: ctx.timezone,
			tracking: { isNewChat: ctx.isNewChat, domainHost: new URL(this._config.redirectUrl).host },
		});
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
		return { ...state, lastMessage };
	}

	private async _editAnswerMessage(
		ctx: DiscordConversationContext,
		answerUrl?: string,
		overflowAttached = false,
	): Promise<void> {
		const answerMessage = ctx.convMessage;
		if (!answerMessage) {
			return;
		}
		const appName = await getAppName();
		const body = truncateMarkdown(
			this._renderBody(ctx),
			this._getAnswerPostBudget(answerUrl, appName),
			overflowAttached ? DISCORD_ATTACHMENT_NOTICE : undefined,
		);
		const message = createMarkdownAnswerMessage(body, answerUrl, appName).markdown;
		await this._patchAnswerPost(answerMessage.id, (state) => {
			state.message = message;
		});
	}

	private async _editAnswerMessageFailSoft(
		ctx: DiscordConversationContext,
		answerUrl?: string,
		overflowAttached = false,
	): Promise<boolean> {
		try {
			await this._editAnswerMessage(ctx, answerUrl, overflowAttached);
			return true;
		} catch (error) {
			logger.warn(`Failed to update Discord answer message: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
			});
			return false;
		}
	}

	private _getAnswerPostBudget(answerUrl: string | undefined, appName: string): number {
		const linkLength = answerUrl ? createMarkdownAnswerMessage('', answerUrl, appName).markdown.length + 2 : 0;
		return Math.max(DISCORD_POST_MAX_LENGTH - linkLength, 0);
	}

	/** Uploads the whole answer as a file when it does not fit in a single Discord post. */
	private async _attachAnswerOverflow(ctx: DiscordConversationContext, answerUrl?: string): Promise<boolean> {
		if (!ctx.convMessage) {
			return false;
		}
		const appName = await getAppName();
		const attachment = createDiscordAnswerAttachment(
			this._renderBody(ctx),
			this._getAnswerPostBudget(answerUrl, appName),
		);
		if (!attachment) {
			return false;
		}
		try {
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
		const sqlOutput = await resolveSqlOutput({
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
			const table = createMarkdownTable({ title: part.input.title ?? 'Results', rows: sqlOutput.rows });
			if (!table) {
				return;
			}
			state.renderedToolCallIds.add(part.toolCallId);
			ctx.answerTextPartIndex = -1;
			ctx.bodyParts.push(formatDiscordTable(table));
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
			const appName = await getAppName();
			ctx.bodyParts.push(
				`⚠️ This chart couldn't be rendered in Discord. [Open it in ${escapeMarkdownText(appName)}](${this._getChatUrl(ctx)}).`,
			);
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
			const appName = await getAppName();
			ctx.answerTextPartIndex = -1;
			ctx.bodyParts.push(
				`🗺️ **${part.input.title}**\n\n[View interactive map in ${escapeMarkdownText(appName)}](${this._getChatUrl(ctx)})`,
			);
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

	private _getChatUrl(ctx: DiscordConversationContext): string {
		return new URL(ctx.chatId, this._config.redirectUrl).toString();
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
	): Promise<void> {
		await this._mutateAnswerPost(postId, async () => {
			const state = this._answerPostStates.get(postId);
			if (!state || updateState(state) === false) {
				return;
			}
			const { channelId, threadId } = this._adapter.decodeThreadId(state.sentMessage.threadId);
			await editDiscordMessage({
				botToken: this._config.botToken,
				channelId: threadId || channelId,
				messageId: state.sentMessage.id,
				payload: buildDiscordAnswerPayload(state.message, state.stopAttached),
			});
			state.appliedStopAttached = state.stopAttached;
		});
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
		ctx: DiscordConversationContext,
		assistantMessageId: string | undefined,
	): Promise<void> {
		if (!ctx.convMessage || !assistantMessageId) {
			return;
		}
		const postId = ctx.convMessage.id;
		try {
			await chatQueries.attachDiscordMessageId(assistantMessageId, postId);
		} catch (error) {
			logger.warn(`Could not persist the Discord feedback message link: ${String(error)}`, {
				source: 'system',
				projectId: this._config.projectId,
				context: { postId, assistantMessageId },
			});
			return;
		}
		try {
			await this._adapter.addReaction(ctx.thread.id, postId, DISCORD_THUMBS_UP);
			await new Promise((resolve) => setTimeout(resolve, REACTION_SEED_INTERVAL_MS));
			await this._adapter.addReaction(ctx.thread.id, postId, DISCORD_THUMBS_DOWN);
		} catch (error) {
			logger.warn(`Failed to seed Discord feedback reactions: ${String(error)}`, {
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
		await this.stopProject(projectId);
		if (config) {
			await this.startForProject(config);
		}
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

	public async notifyAccountLinked(projectId: string, discordUserId: string, email: string): Promise<void> {
		await this._bots
			.get(projectId)
			?.sendDirectMessage(discordUserId, `✅ Linked to ${email}. You can now ask me questions!`);
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
