import { randomBytes } from 'node:crypto';

import { createSlackAdapter } from '@chat-adapter/slack';
import { createMemoryState } from '@chat-adapter/state-memory';
import { CITATION_TAG_REGEX } from '@nao/shared';
import type { LlmSelectedModel } from '@nao/shared/types';
import { WebClient } from '@slack/web-api';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Card, Chat, deriveChannelId, Message, SentMessage, Thread, ThreadImpl } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import {
	getProjectSlackConfig,
	listSocketModeSlackConfigs,
	SlackConfig,
} from '../queries/project-slack-config.queries';
import { getUser } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { buildUserAddedEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';
import {
	createCompletionCard,
	createFeedbackModal,
	createImageBlock,
	createLiveToolCall,
	createStopButtonCard,
	createSummaryToolCalls,
	createTextBlock,
	escapeCsvCell,
	EXCLUDED_TOOLS,
	FEEDBACK_MODAL_CALLBACK_ID,
	formatMessagingError,
	formatSlackMessageText,
} from '../utils/messaging-provider';
import { shouldReplyToSlackThreadMessage } from '../utils/slack-reply-policy';
import { isEmailDomainAllowed } from '../utils/utils';
import { agentService } from './agent';
import { posthog, PostHogEvent } from './posthog';
import { SlackSocketBridge } from './slack-socket-bridge';
import { ensureMessagingProviderUser } from './team-member';

const UPDATE_INTERVAL_MS = 200;

const SLACK_MENTION_REGEX = /(?:<@|@)([A-Z0-9]+)(?:\|[^>]+)?>?\s*/g;
const SLACK_USER_MENTION_REGEX = /(^|[^\w<])@([a-zA-Z0-9._-]+)/g;
const CODE_SPAN_REGEX = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/;
const RESERVED_SLACK_MENTIONS = new Set(['channel', 'everyone', 'here']);

type SlackReplyMessage = NonNullable<Awaited<ReturnType<WebClient['conversations']['replies']>>['messages']>[number];
type SlackUser = NonNullable<Awaited<ReturnType<WebClient['users']['list']>>['members']>[number];

type SlackBotWebhooks = NonNullable<Chat['webhooks']>;
type SlackPostMessageOptions = {
	chatId?: string;
	subscribeThread?: boolean;
};
type SlackPostMessageResult = {
	channel: string;
	ts: string;
	threadId: string;
};
export type SlackFileUpload = {
	filename: string;
	content: Buffer;
	title?: string;
};

class ProjectSlackBot {
	public readonly projectId: string;
	private _bot: Chat;
	private _slackClient: WebClient;
	private _redirectUrl: string;
	private _modelSelection: LlmSelectedModel | undefined;
	private _config: SlackConfig;
	private _socketBridge: SlackSocketBridge | null = null;
	private _adapterSigningSecret: string;
	private _autoCreateUsersEnabled: boolean;
	private _autoCreateUsersDomains: string[];
	private _lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }> = new Map();
	private _slackMentionByHandle: Map<string, string> = new Map();

	constructor(config: SlackConfig) {
		this.projectId = config.projectId;
		this._config = config;
		this._autoCreateUsersEnabled = config.autoCreateUsersEnabled;
		this._autoCreateUsersDomains = config.autoCreateUsersDomains;
		this._redirectUrl = config.redirectUrl;
		this._modelSelection = config.modelSelection;
		this._slackClient = new WebClient(config.botToken);

		this._adapterSigningSecret =
			config.transportMode === 'socket' && !config.signingSecret
				? randomBytes(32).toString('hex')
				: config.signingSecret;

		this._bot = new Chat({
			userName: 'nao',
			adapters: {
				slack: createSlackAdapter({
					botToken: config.botToken,
					signingSecret: this._adapterSigningSecret,
				}),
			},
			state: createMemoryState(),
		});

		this._registerHandlers();
	}

	public get webhooks() {
		return this._bot.webhooks;
	}

	public get config(): SlackConfig {
		return this._config;
	}

	public async startSocketMode(): Promise<void> {
		if (this._config.transportMode !== 'socket' || !this._config.appToken) {
			return;
		}
		if (this._socketBridge) {
			return;
		}
		this._socketBridge = new SlackSocketBridge({
			projectId: this.projectId,
			appToken: this._config.appToken,
			signingSecret: this._adapterSigningSecret,
			webhooks: this._bot.webhooks,
		});
		await this._socketBridge.start();
	}

	public async stopSocketMode(): Promise<void> {
		if (!this._socketBridge) {
			return;
		}
		await this._socketBridge.stop();
		this._socketBridge = null;
	}

	public async dispose(): Promise<void> {
		await this.stopSocketMode();
	}

	public async postMessage(channelId: string, text: string): Promise<SlackPostMessageResult> {
		const resolvedText = await this._resolveSlackUserMentions(text);
		const result = await this._slackClient.chat.postMessage({
			channel: channelId,
			text: formatSlackMessageText(resolvedText),
		});

		if (!result.ok) {
			throw new Error(result.error ?? 'Failed to post Slack message.');
		}
		if (!result.channel || !result.ts) {
			throw new Error('Slack did not return a channel and timestamp for the posted message.');
		}

		const threadId = getSlackThreadId(result.channel, result.ts);
		return { channel: result.channel, ts: result.ts, threadId };
	}

	public async subscribeThread(threadId: string): Promise<void> {
		await this._bot.initialize();
		const adapter = this._bot.getAdapter('slack');
		const thread = new ThreadImpl({
			adapter,
			stateAdapter: this._bot.getState(),
			id: threadId,
			channelId: deriveChannelId(adapter, threadId),
			isDM: false,
		});
		await thread.subscribe();
	}

	private async _resolveSlackUserMentions(text: string): Promise<string> {
		const handles = extractSlackUserMentionHandles(text);
		if (handles.length === 0) {
			return text;
		}

		const mentionByHandle = await this._getSlackUserMentions(handles);
		if (mentionByHandle.size === 0) {
			return text;
		}
		return replaceSlackUserMentionHandles(text, mentionByHandle);
	}

	private async _getSlackUserMentions(handles: string[]): Promise<Map<string, string>> {
		const mentionByHandle = new Map<string, string>();
		const unresolvedHandles = new Set<string>();

		for (const handle of handles) {
			const cachedMention = this._slackMentionByHandle.get(handle);
			if (cachedMention) {
				mentionByHandle.set(handle, cachedMention);
			} else {
				unresolvedHandles.add(handle);
			}
		}

		if (unresolvedHandles.size === 0) {
			return mentionByHandle;
		}

		try {
			const users = await this._listSlackUsers();
			for (const user of users) {
				if (!user.id || user.deleted) {
					continue;
				}

				const mention = `<@${user.id}>`;
				for (const candidate of getSlackUserHandleCandidates(user)) {
					if (!unresolvedHandles.has(candidate)) {
						continue;
					}
					this._slackMentionByHandle.set(candidate, mention);
					mentionByHandle.set(candidate, mention);
					unresolvedHandles.delete(candidate);
				}
				if (unresolvedHandles.size === 0) {
					break;
				}
			}
		} catch (error) {
			logger.warn(`Failed to resolve Slack user mentions: ${String(error)}`, {
				source: 'system',
				context: { projectId: this.projectId, handles },
			});
		}

		return mentionByHandle;
	}

	private async _listSlackUsers(): Promise<SlackUser[]> {
		const users: SlackUser[] = [];
		let cursor: string | undefined;
		do {
			const response = await this._slackClient.users.list({ cursor, limit: 200 });
			if (!response.ok) {
				throw new Error(response.error ?? 'Failed to list Slack users.');
			}
			users.push(...(response.members ?? []));
			cursor = response.response_metadata?.next_cursor || undefined;
		} while (cursor);
		return users;
	}

	public async uploadFiles(threadId: string, files: SlackFileUpload[]): Promise<void> {
		const [, channelId, threadTs] = threadId.split(':');
		if (!channelId || !threadTs || files.length === 0) {
			return;
		}

		for (const file of files) {
			await this._slackClient.files.uploadV2({
				channel_id: channelId,
				thread_ts: threadTs,
				filename: file.filename,
				title: file.title,
				file: file.content,
			});
		}
	}

	private _registerHandlers(): void {
		this._bot.onNewMention(async (thread, message) => {
			const startsThread = await this._isThreadStarter(thread.id);
			if (startsThread && this._config.replyMode === 'thread') {
				await thread.subscribe();
			}
			await this._handleWorkFlow(thread, message, { fetchUnseenMessages: true });
		});

		this._bot.onSubscribedMessage(async (thread, message) => {
			if (!shouldReplyToSlackThreadMessage(this._config.replyMode, message)) {
				return;
			}
			await this._handleWorkFlow(thread, message, { fetchUnseenMessages: false });
		});

		this._bot.onNewMessage(/[\s\S]+/, async (thread, message) => {
			if (message.isMention || !shouldReplyToSlackThreadMessage(this._config.replyMode, message)) {
				return;
			}
			const existingChat = await chatQueries.getChatBySlackThread(thread.id);
			if (!existingChat) {
				return;
			}
			await thread.subscribe();
			await this._handleWorkFlow(thread, message, { fetchUnseenMessages: true });
		});

		this._bot.onAction('stop_generation', async (event) => {
			console.log('stop_generation', event);
			try {
				const existingChat = await chatQueries.getChatBySlackThread(event.threadId);
				if (!existingChat) {
					logger.warn('stop_generation: no chat found for thread', {
						source: 'system',
						context: { threadId: event.threadId },
					});
					return;
				}
				const agent = agentService.get(existingChat.id);
				if (!agent) {
					logger.warn('stop_generation: no active agent for chat', {
						source: 'system',
						context: { chatId: existingChat.id },
					});
					return;
				}
				agent.stop();
			} catch (error) {
				logger.error(`stop_generation failed: ${String(error)}`, {
					source: 'system',
					context: { threadId: event.threadId },
				});
			}
		});

		this._bot.onAction('feedback_positive', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.threadId);
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'up' });
			const completion = this._lastCompletionCard.get(event.threadId);
			if (completion) {
				await completion.card.edit(createCompletionCard(completion.chatUrl, 'up'));
			}
		});

		this._bot.onAction('feedback_negative', async (event) => {
			await event.openModal({
				...createFeedbackModal(),
				privateMetadata: event.threadId,
			});
		});

		this._bot.onModalSubmit(FEEDBACK_MODAL_CALLBACK_ID, async (event) => {
			const threadId = event.privateMetadata;
			if (!threadId) {
				return;
			}
			const messageId = await this._getLastAssistantMessageId(threadId);
			if (!messageId) {
				return;
			}

			const chat = await chatQueries.getChatBySlackThread(threadId);
			if (!chat) {
				throw new Error(`Chat for thread ${threadId} not found.`);
			}

			const ownerId = await chatQueries.getOwnerOfChatAndMessage(chat.id, messageId);
			if (!ownerId) {
				throw new Error(`Message with id ${messageId} not found.`);
			}

			const slackUserId = event.user?.userId;
			const slackUser = slackUserId ? await this._getSlackUser(slackUserId) : null;
			const email = slackUser?.profile?.email?.toLowerCase() || null;
			const user = email ? await getUser({ email }) : null;

			if (ownerId !== user?.id) {
				throw new Error(`You are not authorized to provide feedback on this message.`);
			}

			await feedbackQueries.upsertFeedback({
				messageId,
				vote: 'down',
				explanation: event.values['explanation'] || undefined,
			});
			const completion = this._lastCompletionCard.get(threadId);
			if (completion) {
				await completion.card.edit(createCompletionCard(completion.chatUrl, 'down'));
			}
			return { action: 'close' };
		});
	}

	private async _handleWorkFlow(
		thread: Thread,
		userMessage: Message,
		options: { fetchUnseenMessages: boolean },
	): Promise<void> {
		userMessage.text = userMessage.text.replace(SLACK_MENTION_REGEX, '').trim();

		const ctx: ConversationContext = {
			thread,
			userMessage,
			user: null,
			chatId: '',
			convMessage: null,
			blocks: [],
			textBlockIndex: -1,
			isNewChat: false,
			modelId: undefined,
			timezone: undefined,
		};

		await this._validateUserAccess(ctx);

		try {
			ctx.convMessage = await ctx.thread.post('✨ nao is answering...');
			await this._saveOrUpdateUserMessage(ctx, options.fetchUnseenMessages);

			const [chat] = await chatQueries.getChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx);
		} catch (error) {
			const errorMessage = formatMessagingError(error);
			ctx.blocks.push(createTextBlock(errorMessage));
			if (ctx.convMessage) {
				await ctx.convMessage.edit(Card({ children: ctx.blocks }));
			} else {
				await ctx.thread.post(errorMessage);
			}
		}
	}

	private async _validateUserAccess(ctx: ConversationContext): Promise<void> {
		const slackUserId = ctx.userMessage.author.userId;
		const slackUser = await this._getSlackUser(slackUserId);
		const email = slackUser?.profile?.email?.toLowerCase() || null;

		if (!email) {
			throw new Error('Could not retrieve user email from Slack');
		}

		ctx.timezone = slackUser?.tz || undefined;

		if (this._canAutoProvision(email)) {
			const project = await projectQueries.getProjectById(this.projectId);
			const projectName = project?.name ?? 'nao';
			const displayName = slackUser?.real_name || slackUser?.name || email.split('@')[0];
			ctx.user = await ensureMessagingProviderUser({
				email,
				name: displayName,
				projectId: this.projectId,
				buildEmail: (user, temporaryPassword) =>
					buildUserAddedEmail(user, projectName, 'project', temporaryPassword),
			});
			return;
		}

		await this._resolveExistingUser(ctx, email);
		await this._checkUserBelongsToProject(ctx);
	}

	private _canAutoProvision(email: string): boolean {
		if (!this._autoCreateUsersEnabled || this._autoCreateUsersDomains.length === 0) {
			return false;
		}
		return isEmailDomainAllowed(email, this._autoCreateUsersDomains.join(','));
	}

	private async _resolveExistingUser(ctx: ConversationContext, email: string): Promise<void> {
		const user = await getUser({ email });
		if (!user) {
			await ctx.thread.post(
				`❌ No user found. Create an account with \`${email}\` on ${this._redirectUrl} to sign up.`,
			);
			throw new Error('User not found');
		}
		ctx.user = user;
	}

	private async _getSlackUser(userId: string) {
		const response = await this._slackClient.users.info({ user: userId });
		return response?.user || null;
	}

	private async _checkUserBelongsToProject(ctx: ConversationContext): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this.projectId, ctx.user!.id);
		if (role !== 'admin' && role !== 'user') {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(ctx: ConversationContext, fetchUnseenMessages: boolean): Promise<void> {
		const text = ctx.userMessage.text;
		const unseenMessages = fetchUnseenMessages
			? await this._getUnseenSlackMessages(ctx.thread.id, ctx.userMessage.id)
			: null;
		const messageText = unseenMessages
			? `[Previous messages in this Slack thread]\n${unseenMessages}\n\n[Your message]\n${text}`
			: text;

		const existingChat = await chatQueries.getChatBySlackThread(ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text: messageText }],
				chatId: existingChat.id,
				source: 'slack',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
			return;
		}

		const title = createChatTitle({ text });
		const [createdChat] = await chatQueries.createChat(
			{ title, userId: ctx.user!.id, projectId: this.projectId, slackThreadId: ctx.thread.id },
			{ text: messageText, source: 'slack' },
		);
		ctx.chatId = createdChat.id;
		ctx.isNewChat = true;
	}

	private async _getUnseenSlackMessages(threadId: string, currentMessageId: string): Promise<string | null> {
		const [, channelId, threadTs] = threadId.split(':');
		if (!channelId || !threadTs) {
			return null;
		}

		try {
			const result = await this._slackClient.conversations.replies({
				channel: channelId,
				ts: threadTs,
			});
			const messages = this._extractUnseenUserMessages(result?.messages ?? [], currentMessageId);
			if (messages.length === 0) {
				return null;
			}
			const userNames = await this._resolveUserNames(messages);
			return this._formatThreadMessages(messages, userNames);
		} catch (error) {
			logger.error(`Failed to fetch Slack thread history: ${String(error)}`, {
				source: 'system',
				context: { threadId },
			});
			return null;
		}
	}

	private _extractUnseenUserMessages(
		allMessages: SlackReplyMessage[],
		currentMessageId: string,
	): SlackReplyMessage[] {
		const currentIndex = allMessages.findIndex((msg) => msg.ts === currentMessageId);
		if (currentIndex === -1) {
			return [];
		}
		const priorMessages = allMessages.slice(0, currentIndex);
		const lastBotIndex = this._findLastBotMessageIndex(priorMessages);
		return priorMessages.slice(lastBotIndex + 1).filter((msg) => !this._isBotMessage(msg));
	}

	private _findLastBotMessageIndex(messages: SlackReplyMessage[]): number {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (this._isBotMessage(messages[i])) {
				return i;
			}
		}
		return -1;
	}

	private _isBotMessage(message: SlackReplyMessage): boolean {
		return !!message.bot_id || (message as { subtype?: string }).subtype === 'bot_message';
	}

	private async _resolveUserNames(messages: SlackReplyMessage[]): Promise<Map<string, string>> {
		const userIds = [...new Set(messages.map((m) => m.user).filter((u): u is string => !!u))];
		const entries = await Promise.all(
			userIds.map(async (userId): Promise<[string, string]> => {
				const slackUser = await this._getSlackUser(userId);
				return [userId, slackUser?.real_name || slackUser?.name || userId];
			}),
		);
		return new Map(entries);
	}

	private _formatThreadMessages(messages: SlackReplyMessage[], userNames: Map<string, string>): string {
		return messages
			.map((msg) => {
				const name = msg.user ? userNames.get(msg.user) || msg.user : 'Unknown';
				const text = (msg.text || '').replace(SLACK_MENTION_REGEX, '').trim();
				return `${name}: ${text}`;
			})
			.join('\n');
	}

	private async _isThreadStarter(threadId: string): Promise<boolean> {
		const [, channelId, threadTs] = threadId.split(':');
		if (!channelId || !threadTs) {
			return false;
		}
		try {
			const result = await this._slackClient.conversations.replies({
				channel: channelId,
				ts: threadTs,
				limit: 2,
			});
			return (result?.messages?.length ?? 0) <= 1;
		} catch {
			return false;
		}
	}

	private async _handleStreamAgent(chat: UIChat, ctx: ConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const stopCard = await ctx.thread.post(createStopButtonCard());

		let state: StreamState | undefined;
		try {
			state = await this._readStreamAndUpdateSlackMessage(stream, ctx);
		} finally {
			await stopCard.delete().catch(() => {});
		}

		if (state) {
			await this._uploadLastSqlResultAsCsv(state, ctx);
		}
		await this._lastCompletionCard.get(ctx.thread.id)?.card.delete();
		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		const card = await ctx.thread.post(createCompletionCard(chatUrl));
		this._lastCompletionCard.set(ctx.thread.id, { card, chatUrl });

		posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
			project_id: this.projectId,
			chat_id: ctx.chatId,
			model_id: ctx.modelId,
			is_new_chat: ctx.isNewChat,
			source: 'slack',
			domain_host: new URL(this._redirectUrl).host,
		});
	}

	private async _createAgentStream(
		chat: UIChat,
		ctx: ConversationContext,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this.projectId },
			this._modelSelection,
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'slack', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateSlackMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
	): Promise<StreamState> {
		const state: StreamState = {
			renderedChartIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream, terminateOnError: true })) {
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
			} else if (part.type === 'tool-execute_sql') {
				this._handleSqlPart(part, state);
			} else if (part.type === 'tool-display_chart') {
				await this._handleChartPart(part, state, ctx);
			}
		}

		await this._sendFinalText(ctx);
		return state;
	}

	private async _handleTextPart(
		part: Extract<UIMessagePart, { type: 'text' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<void> {
		this._updateTextBlock(part.text, ctx);
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS || !part.text) {
			return;
		}
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
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

	private async _handleChartPart(
		part: Extract<UIMessagePart, { type: 'tool-display_chart' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedChartIds.has(part.toolCallId)) {
			return;
		}
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			return;
		}
		try {
			const png = generateChartImage({ config: part.input, data: sqlOutput.rows });
			const chartId = await chartImageQueries.saveChart(part.toolCallId, png.toString('base64'));
			state.renderedChartIds.add(part.toolCallId);

			if (this._config.transportMode === 'socket') {
				await this._uploadChartImageFile(png, sqlOutput.name, ctx);
				return;
			}

			const imageUrl = new URL(`c/${ctx.chatId}/${chartId}.png`, this._redirectUrl).toString();
			ctx.textBlockIndex = -1;
			ctx.blocks.push(createImageBlock(imageUrl));
			await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
		} catch (error) {
			logger.error(`Chart image generation failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
		}
	}

	private async _uploadChartImageFile(png: Buffer, name: string | null, ctx: ConversationContext): Promise<void> {
		const [, channelId, threadTs] = ctx.thread.id.split(':');
		const filename = name ? `${name.toLowerCase().replace(/\s+/g, '_')}.png` : 'chart.png';
		await this._slackClient.files.uploadV2({
			channel_id: channelId,
			thread_ts: threadTs,
			filename,
			file: png,
		});
	}

	private async _handleCollapsibleToolPart(
		part: Extract<UIMessagePart, { toolCallId: string }>,
		state: StreamState,
		ctx: ConversationContext,
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
			state.toolGroupBlockIndex = ctx.blocks.length;
			ctx.blocks.push(createLiveToolCall(state.toolGroup));
		} else {
			ctx.blocks[state.toolGroupBlockIndex] = createLiveToolCall(state.toolGroup);
		}

		if (Date.now() - state.lastUpdateAt >= UPDATE_INTERVAL_MS) {
			await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
			state.lastUpdateAt = Date.now();
		}
	}

	private _flushToolGroup(state: StreamState, ctx: ConversationContext): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		ctx.blocks[state.toolGroupBlockIndex] = createSummaryToolCalls(state.toolGroup);
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
	}

	private async _sendFinalText(ctx: ConversationContext): Promise<void> {
		if (ctx.textBlockIndex === -1) {
			return;
		}
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
	}

	private _updateTextBlock(text: string, ctx: ConversationContext): void {
		const block = createTextBlock(text.replace(CITATION_TAG_REGEX, ''));
		if (ctx.textBlockIndex === -1) {
			ctx.textBlockIndex = ctx.blocks.length;
			ctx.blocks.push(block);
		} else {
			ctx.blocks[ctx.textBlockIndex] = block;
		}
	}

	private async _uploadLastSqlResultAsCsv(state: StreamState, ctx: ConversationContext): Promise<void> {
		if (state.sqlOutputs.size === 0) {
			return;
		}
		const { name, rows } = [...state.sqlOutputs.values()].at(-1)!;
		if (rows.length === 0) {
			return;
		}
		const columns = Object.keys(rows[0]);
		const header = columns.join(',');
		const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(',')).join('\n');
		const csv = `${header}\n${body}`;
		const filename = name ? `${name.toLowerCase().replace(/\s+/g, '_')}.csv` : 'data.csv';

		const [, channelId, threadTs] = ctx.thread.id.split(':');
		await this._slackClient.files.uploadV2({
			channel_id: channelId,
			thread_ts: threadTs,
			filename,
			content: csv,
		});
	}

	private async _getLastAssistantMessageId(threadId: string): Promise<string | null> {
		const chat = await chatQueries.getChatBySlackThread(threadId);
		if (!chat) {
			return null;
		}
		return chatQueries.getLastAssistantMessageId(chat.id);
	}
}

class SlackService {
	private _bots: Map<string, ProjectSlackBot> = new Map();

	constructor() {}

	public async postMessage(
		projectId: string,
		channelId: string,
		text: string,
		options: SlackPostMessageOptions = {},
	): Promise<SlackPostMessageResult> {
		const config = await getProjectSlackConfig(projectId);
		if (!config) {
			throw new Error('Slack is not configured for this project.');
		}

		const bot = await this._getOrCreateBot(config);
		const result = await bot.postMessage(channelId, text);
		if (options.chatId) {
			await chatQueries.attachSlackThread(options.chatId, result.threadId);
		}
		if (options.subscribeThread ?? !!options.chatId) {
			await bot.subscribeThread(result.threadId);
		}
		return result;
	}

	public async uploadFiles(projectId: string, threadId: string, files: SlackFileUpload[]): Promise<void> {
		if (files.length === 0) {
			return;
		}
		const config = await getProjectSlackConfig(projectId);
		if (!config) {
			throw new Error('Slack is not configured for this project.');
		}
		const bot = await this._getOrCreateBot(config);
		await bot.uploadFiles(threadId, files);
	}

	public async getWebhooks(config: SlackConfig): Promise<SlackBotWebhooks | undefined> {
		const bot = await this._getOrCreateBot(config);
		return bot.webhooks;
	}

	public async startSocketModeForAllProjects(): Promise<void> {
		try {
			const configs = await listSocketModeSlackConfigs();
			for (const config of configs) {
				try {
					const bot = await this._getOrCreateBot(config);
					await bot.startSocketMode();
				} catch (error) {
					logger.error(
						`Failed to start Slack socket mode for project ${config.projectId}: ${String(error)}`,
						{
							source: 'system',
							context: { projectId: config.projectId },
						},
					);
				}
			}
		} catch (error) {
			logger.error(`Failed to enumerate Slack socket mode projects: ${String(error)}`, {
				source: 'system',
			});
		}
	}

	public async syncProjectSocketMode(config: SlackConfig | null, projectId: string): Promise<void> {
		const existing = this._bots.get(projectId);
		if (!config || config.transportMode !== 'socket') {
			if (existing) {
				await existing.stopSocketMode();
			}
			return;
		}
		const bot = await this._getOrCreateBot(config);
		await bot.stopSocketMode();
		await bot.startSocketMode();
	}

	public async stopProject(projectId: string): Promise<void> {
		const existing = this._bots.get(projectId);
		if (!existing) {
			return;
		}
		await existing.dispose();
		this._bots.delete(projectId);
	}

	private async _getOrCreateBot(config: SlackConfig): Promise<ProjectSlackBot> {
		const existing = this._bots.get(config.projectId);
		if (existing && !this._configChanged(existing.config, config)) {
			return existing;
		}
		if (existing) {
			this._bots.delete(config.projectId);
			try {
				await existing.dispose();
			} catch (error) {
				logger.warn(`Failed to dispose previous Slack bot for project ${config.projectId}: ${String(error)}`, {
					source: 'system',
					context: { projectId: config.projectId },
				});
			}
		}
		const bot = new ProjectSlackBot(config);
		this._bots.set(config.projectId, bot);
		return bot;
	}

	private _configChanged(previous: SlackConfig, next: SlackConfig): boolean {
		return (
			previous.botToken !== next.botToken ||
			previous.signingSecret !== next.signingSecret ||
			previous.redirectUrl !== next.redirectUrl ||
			previous.transportMode !== next.transportMode ||
			previous.appToken !== next.appToken ||
			previous.replyMode !== next.replyMode ||
			previous.autoCreateUsersEnabled !== next.autoCreateUsersEnabled ||
			previous.autoCreateUsersDomains.join('\0') !== next.autoCreateUsersDomains.join('\0') ||
			previous.modelSelection?.provider !== next.modelSelection?.provider ||
			previous.modelSelection?.modelId !== next.modelSelection?.modelId
		);
	}
}

function getSlackThreadId(channelId: string, threadTs: string): string {
	return `slack:${channelId}:${threadTs}`;
}

function extractSlackUserMentionHandles(text: string): string[] {
	const handles = new Set<string>();
	forEachNonCodeText(text, (part) => {
		part.replace(SLACK_USER_MENTION_REGEX, (_match, _prefix: string, handle: string) => {
			const normalized = normalizeSlackHandle(handle);
			if (normalized && !RESERVED_SLACK_MENTIONS.has(normalized)) {
				handles.add(normalized);
			}
			return _match;
		});
	});
	return [...handles];
}

function replaceSlackUserMentionHandles(text: string, mentionByHandle: Map<string, string>): string {
	return text
		.split(CODE_SPAN_REGEX)
		.map((part, index) => {
			if (index % 2 === 1) {
				return part;
			}
			return part.replace(SLACK_USER_MENTION_REGEX, (match, prefix: string, handle: string) => {
				const normalized = normalizeSlackHandle(handle);
				const mention = normalized ? mentionByHandle.get(normalized) : null;
				return mention ? `${prefix}${mention}` : match;
			});
		})
		.join('');
}

function forEachNonCodeText(text: string, callback: (part: string) => void): void {
	text.split(CODE_SPAN_REGEX).forEach((part, index) => {
		if (index % 2 === 0) {
			callback(part);
		}
	});
}

function getSlackUserHandleCandidates(user: SlackUser): string[] {
	const profile = user.profile as
		| {
				display_name?: string;
				display_name_normalized?: string;
				real_name?: string;
				real_name_normalized?: string;
		  }
		| undefined;

	return [
		user.name,
		profile?.display_name,
		profile?.display_name_normalized,
		profile?.real_name,
		profile?.real_name_normalized,
	]
		.map((candidate) => normalizeSlackHandle(candidate))
		.filter((candidate): candidate is string => !!candidate);
}

function normalizeSlackHandle(handle: string | null | undefined): string | null {
	const normalized = handle?.trim().replace(/^@/, '').toLowerCase();
	return normalized || null;
}

export const slackService = new SlackService();
