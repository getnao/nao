import { randomBytes } from 'node:crypto';

import { cardToBlockKit, createSlackAdapter } from '@chat-adapter/slack';
import { createMemoryState } from '@chat-adapter/state-memory';
import { stripAssistantTags } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';
import type { LlmSelectedModel } from '@nao/shared/types';
import {
	type ChatPostMessageArguments,
	type ChatPostMessageResponse,
	type ChatUpdateArguments,
	WebClient,
} from '@slack/web-api';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Card, Chat, deriveChannelId, Message, parseMarkdown, SlashCommandEvent, Thread, ThreadImpl } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import type { User } from '../db/abstractSchema';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import {
	getProjectSlackConfig,
	listSocketModeSlackConfigs,
	SlackConfig,
} from '../queries/project-slack-config.queries';
import { addUserEmailDomain, getUser } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { buildUserAddedEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';
import {
	buildSlackCardNotificationText,
	buildSlackTableBlocks,
	countHiddenTableNotices,
	createCompletionCard,
	createFeedbackModal,
	createImageBlock,
	createLiveToolCall,
	createMapLinkCard,
	createSlackTableRenderState,
	createStopButtonActions,
	createSummaryToolCalls,
	createTextBlock,
	createTextBlocks,
	EXCLUDED_TOOLS,
	FEEDBACK_MODAL_CALLBACK_ID,
	formatClarificationText,
	formatMessagingError,
	formatSlackMessageText,
	isRecoverableSlackPayloadError,
	renderMapImage,
	type SlackTableRenderState,
	type TruncationNotice,
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
	threadId?: string;
};
type SlackPostMessageResult = {
	channel: string;
	ts: string;
	threadId: string;
};
type SlackStreamState = {
	closedTextRuns: {
		blockIndex: number;
		blockCount: number;
		sourceStart: number;
		sourceEnd: number;
	}[];
	emptyRunBlockIndex: number;
	messageTs: string | null;
	textRunStart: number;
	lastDeliveredChildren: ConversationContext['blocks'];
	latestSourceText: string;
	payloadRejected: boolean;
	tableStateAtRunEnd: SlackTableRenderState | null;
	tableStateAtRunStart: SlackTableRenderState;
};
type SlackCompletionCard = {
	channelId: string;
	messageTs: string;
	chatUrl: string;
	hiddenTables: number;
};
type SlackActiveStream = {
	agent: Awaited<ReturnType<typeof agentService.create>> | null;
	stopRequested: boolean;
};
export type SlackFileUpload = {
	filename: string;
	content: Buffer;
	title?: string;
};

type SlackUserAuthorization =
	| { status: 'authorized'; user: User; timezone: string | undefined }
	| { status: 'no-email' }
	| { status: 'user-not-found'; email: string }
	| { status: 'no-permission' };

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
	private _autoMergeUsersEnabled: boolean;
	private _lastCompletionCard = new Map<string, SlackCompletionCard>();
	private _slackMentionByHandle: Map<string, string> = new Map();
	private _channelMembershipAttempts: Set<string> = new Set();
	private _activeStreamsByThread = new Map<string, SlackActiveStream>();
	private _slackStreamStates = new WeakMap<ConversationContext, SlackStreamState>();

	constructor(config: SlackConfig) {
		this.projectId = config.projectId;
		this._config = config;
		this._autoCreateUsersEnabled = config.autoCreateUsersEnabled;
		this._autoCreateUsersDomains = config.autoCreateUsersDomains;
		this._autoMergeUsersEnabled = config.autoMergeUsersEnabled;
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

	public async postMessage(channelId: string, text: string, threadTs?: string): Promise<SlackPostMessageResult> {
		await this._ensureChannelMembership(channelId);
		const resolvedText = await this._resolveSlackUserMentions(text);
		const args: ChatPostMessageArguments = {
			channel: channelId,
			text: formatSlackMessageText(resolvedText),
			thread_ts: threadTs,
		};
		const blocks = buildSlackTableBlocks(resolvedText);
		if (blocks) {
			(args as { blocks?: unknown }).blocks = blocks;
		}

		let result: ChatPostMessageResponse;
		try {
			result = await this._slackClient.chat.postMessage(args);
		} catch (error) {
			if (!blocks) {
				throw error;
			}
			// A rejected block payload must never drop the answer: retry with the text field, which
			// already carries the full content.
			logger.warn(`Slack postMessage failed, retrying without block payload: ${String(error)}`, {
				source: 'system',
				context: { channelId },
			});
			delete (args as { blocks?: unknown }).blocks;
			result = await this._slackClient.chat.postMessage(args);
		}

		if (!result.ok) {
			throw new Error(result.error ?? 'Failed to post Slack message.');
		}
		if (!result.channel || !result.ts) {
			throw new Error('Slack did not return a channel and timestamp for the posted message.');
		}

		const threadId = getSlackThreadId(result.channel, threadTs ?? result.ts);
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

	private async _ensureChannelMembership(channelId: string, options: { force?: boolean } = {}): Promise<void> {
		if (
			channelId.startsWith('D') ||
			channelId.startsWith('G') ||
			(!options.force && this._channelMembershipAttempts.has(channelId))
		) {
			return;
		}
		this._channelMembershipAttempts.add(channelId);
		try {
			await this._slackClient.conversations.join({ channel: channelId });
		} catch (error) {
			logger.warn(`Failed to join Slack channel: ${String(error)}`, {
				source: 'system',
				context: { projectId: this.projectId, channelId },
			});
		}
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
		const { channelId, threadTs } = parseSlackThreadId(threadId);
		if (!channelId || !threadTs || files.length === 0) {
			return;
		}

		await this._ensureChannelMembership(channelId);
		for (const file of files) {
			await this._uploadFileWithMembershipRecovery(channelId, threadTs, file);
		}
	}

	private async _uploadFileWithMembershipRecovery(
		channelId: string,
		threadTs: string,
		file: SlackFileUpload,
	): Promise<void> {
		const upload = async () => {
			await this._slackClient.files.uploadV2({
				channel_id: channelId,
				thread_ts: threadTs,
				filename: file.filename,
				title: file.title,
				file: file.content,
			});
		};

		try {
			await upload();
		} catch (error) {
			if (!isSlackNotInChannelError(error)) {
				throw error;
			}
			await this._ensureChannelMembership(channelId, { force: true });
			await upload();
		}
	}

	private _registerHandlers(): void {
		this._bot.onSlashCommand('/new', async (event) => {
			await this._handleNewCommand(event);
		});

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
			const threadId = this._resolveActionThreadId(event);
			const activeStream = this._activeStreamsByThread.get(threadId);
			if (activeStream) {
				activeStream.stopRequested = true;
				activeStream.agent?.stop();
				return;
			}
			const existingChat = await chatQueries.getChatBySlackThread(threadId);
			if (existingChat && this._stopActiveAgent(existingChat.id)) {
				return;
			}
			logger.warn('stop_generation: no active stream found', {
				source: 'system',
				context: { threadId },
			});
		});

		this._bot.onAction('feedback_positive', async (event) => {
			const threadId = this._resolveActionThreadId(event);
			const messageId = await this._getLastAssistantMessageId(threadId);
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'up' });
			const completion = this._lastCompletionCard.get(threadId);
			if (completion) {
				await this._updateSlackCard(
					completion.channelId,
					completion.messageTs,
					createCompletionCard(completion.chatUrl, 'up', completion.hiddenTables).children,
				);
			}
		});

		this._bot.onAction('feedback_negative', async (event) => {
			const threadId = this._resolveActionThreadId(event);
			await event.openModal({
				...createFeedbackModal(),
				privateMetadata: threadId,
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
				await this._updateSlackCard(
					completion.channelId,
					completion.messageTs,
					createCompletionCard(completion.chatUrl, 'down', completion.hiddenTables).children,
				);
			}
			return { action: 'close' };
		});
	}

	private _resolveActionThreadId(event: { threadId: string; raw: unknown }): string {
		const { channelId } = parseSlackThreadId(event.threadId);
		if (!channelId?.startsWith('D')) {
			return event.threadId;
		}
		const threadTs = (event.raw as { message?: { thread_ts?: string } } | null)?.message?.thread_ts;
		return threadTs ? getSlackThreadId(channelId, threadTs) : `slack:${channelId}:`;
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
			textBlockCount: 0,
			isNewChat: false,
			modelId: undefined,
			timezone: undefined,
		};

		await this._validateUserAccess(ctx);
		const activeStream: SlackActiveStream = { agent: null, stopRequested: false };
		this._activeStreamsByThread.set(ctx.thread.id, activeStream);

		try {
			this._getSlackStreamState(ctx).messageTs = await this._postSlackCard(ctx, [
				createTextBlock('✨ nao is answering...'),
				createStopButtonActions(),
			]);
			await this._saveOrUpdateUserMessage(ctx, options.fetchUnseenMessages);

			const [chat] = await chatQueries.getChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx, activeStream);
		} catch (error) {
			const errorMessage = formatMessagingError(error);
			ctx.blocks.push(createTextBlock(errorMessage));
			if (this._getSlackStreamMessageTs(ctx)) {
				await this._editConversationCard(ctx, ctx.blocks, true);
			} else {
				await ctx.thread.post(errorMessage);
			}
		} finally {
			if (this._activeStreamsByThread.get(ctx.thread.id) === activeStream) {
				this._activeStreamsByThread.delete(ctx.thread.id);
			}
		}
	}

	private async _editConversationCard(
		ctx: ConversationContext,
		children: ConversationContext['blocks'],
		finalDelivery = false,
	): Promise<void> {
		const streamState = this._getSlackStreamState(ctx);
		if (streamState.payloadRejected && !finalDelivery) {
			return;
		}
		if (children.length === 0) {
			return;
		}

		const slackChildren = finalDelivery ? children : [...children, createStopButtonActions()];
		const messageTs = this._getSlackStreamMessageTs(ctx);
		if (!messageTs) {
			try {
				const postedMessageTs = await this._postSlackCard(ctx, slackChildren);
				streamState.messageTs = postedMessageTs;
				streamState.lastDeliveredChildren = [...children];
			} catch (error) {
				if (isRecoverableSlackPayloadError(error)) {
					await this._handleOversizedSlackPayload(ctx, finalDelivery);
					return;
				}
				logger.warn(
					`${finalDelivery ? 'Slack final card post failed' : 'Slack streaming card post failed'}: ${String(error)}`,
					{
						source: 'system',
						context: { chatId: ctx.chatId, threadId: ctx.thread.id },
					},
				);
			}
			return;
		}

		try {
			const { channelId } = this._getSlackMessageDestination(ctx);
			await this._updateSlackCard(channelId, messageTs, slackChildren);
			streamState.lastDeliveredChildren = [...children];
			return;
		} catch (error) {
			if (!isRecoverableSlackPayloadError(error)) {
				logger.warn(
					`${finalDelivery ? 'Slack final card edit failed' : 'Slack streaming card edit failed'}: ${String(error)}`,
					{
						source: 'system',
						context: { chatId: ctx.chatId, threadId: ctx.thread.id },
					},
				);
				return;
			}
			await this._handleOversizedSlackPayload(ctx, finalDelivery);
		}
	}

	private async _handleOversizedSlackPayload(ctx: ConversationContext, finalDelivery: boolean): Promise<void> {
		const streamState = this._getSlackStreamState(ctx);
		if (!streamState.payloadRejected) {
			streamState.payloadRejected = true;
			await this._postSlackText(
				ctx,
				'This answer is too long to show fully in Slack. Open in nao to read the rest.',
			);
		}

		if (!finalDelivery || !streamState.messageTs) {
			return;
		}

		try {
			const { channelId } = this._getSlackMessageDestination(ctx);
			await this._updateSlackCard(channelId, streamState.messageTs, streamState.lastDeliveredChildren);
		} catch (error) {
			logger.warn(`Failed to remove Slack Stop button after oversized payload: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, threadId: ctx.thread.id, messageTs: streamState.messageTs },
			});
		}
	}

	private async _postSlackCard(ctx: ConversationContext, children: ConversationContext['blocks']): Promise<string> {
		const { channelId, threadTs } = this._getSlackMessageDestination(ctx);
		const args: ChatPostMessageArguments = {
			channel: channelId,
			...(threadTs ? { thread_ts: threadTs } : {}),
			text: buildSlackCardNotificationText(children),
		};
		(args as { blocks?: unknown }).blocks = cardToBlockKit(Card({ children }));
		const result = await this._slackClient.chat.postMessage(args);
		if (!result.ok || !result.ts) {
			throw new Error(result.error ?? 'Slack did not return a timestamp for the posted card.');
		}
		return result.ts;
	}

	private async _updateSlackCard(
		channelId: string,
		messageTs: string,
		children: ConversationContext['blocks'],
	): Promise<void> {
		const args: ChatUpdateArguments = {
			channel: channelId,
			ts: messageTs,
			text: buildSlackCardNotificationText(children),
		};
		(args as { blocks?: unknown }).blocks = cardToBlockKit(Card({ children }));
		const result = await this._slackClient.chat.update(args);
		if (!result.ok) {
			throw new Error(result.error ?? 'Slack failed to update the card.');
		}
	}

	private async _postSlackText(ctx: ConversationContext, text: string): Promise<void> {
		const { channelId, threadTs } = this._getSlackMessageDestination(ctx);
		const result = await this._slackClient.chat.postMessage({
			channel: channelId,
			...(threadTs ? { thread_ts: threadTs } : {}),
			text,
		});
		if (!result.ok) {
			throw new Error(result.error ?? 'Slack failed to post the fallback text.');
		}
	}

	private _getSlackMessageDestination(ctx: ConversationContext): {
		channelId: string;
		threadTs: string | undefined;
	} {
		const { channelId, threadTs } = parseSlackThreadId(ctx.thread.id);
		if (!channelId) {
			throw new Error(`Invalid Slack thread ID: ${ctx.thread.id}`);
		}
		return { channelId, threadTs };
	}

	private _getSlackStreamState(ctx: ConversationContext): SlackStreamState {
		const existingState = this._slackStreamStates.get(ctx);
		if (existingState) {
			return existingState;
		}
		const streamState: SlackStreamState = {
			closedTextRuns: [],
			emptyRunBlockIndex: -1,
			messageTs: null,
			textRunStart: 0,
			lastDeliveredChildren: [],
			latestSourceText: '',
			payloadRejected: false,
			tableStateAtRunEnd: null,
			tableStateAtRunStart: createSlackTableRenderState(),
		};
		this._slackStreamStates.set(ctx, streamState);
		return streamState;
	}

	private _getSlackStreamMessageTs(ctx: ConversationContext): string | null {
		return this._getSlackStreamState(ctx).messageTs;
	}

	private async _handleNewCommand(event: SlashCommandEvent): Promise<void> {
		const channelJson = event.channel.toJSON();
		const [, slackChannelId] = channelJson.id.split(':');
		const ephemeralOpts = { fallbackToDM: true };
		if (!slackChannelId) {
			await event.channel.postEphemeral(event.user, '❌ Could not determine the channel.', ephemeralOpts);
			return;
		}

		const question = event.text.trim();

		if (question && !(await this._isPrivateChannel(event))) {
			await event.channel.postEphemeral(
				event.user,
				'❌ `/new <question>` is only available in direct messages and private channels. Send `/new` on its own here, or ask your question in a private conversation with nao.',
				ephemeralOpts,
			);
			return;
		}

		const authorized = await this._authorizeSlashCommandUser(event, ephemeralOpts);
		if (!authorized) {
			return;
		}

		const chatIds = await chatQueries.clearSlackMainThread(slackChannelId);
		for (const chatId of chatIds) {
			agentService.get(chatId)?.stop();
		}

		if (!question) {
			await event.channel.postEphemeral(
				event.user,
				this._newChatConfirmation(chatIds.length > 0, false),
				ephemeralOpts,
			);
			return;
		}

		try {
			await this._startNewChatFromCommand(event, slackChannelId, question);
		} catch (error) {
			logger.error(`Failed to start new chat from /new command: ${String(error)}`, {
				source: 'system',
				context: { projectId: this.projectId, slackChannelId },
			});
			await event.channel.postEphemeral(event.user, formatMessagingError(error), ephemeralOpts);
			return;
		}
		await event.channel.postEphemeral(
			event.user,
			this._newChatConfirmation(chatIds.length > 0, true),
			ephemeralOpts,
		);
	}

	private async _authorizeSlashCommandUser(
		event: SlashCommandEvent,
		ephemeralOpts: { fallbackToDM: boolean },
	): Promise<User | null> {
		const result = await this._resolveAuthorizedUser(event.user.userId);
		switch (result.status) {
			case 'authorized':
				return result.user;
			case 'no-email':
				await event.channel.postEphemeral(
					event.user,
					'❌ Could not retrieve your email from Slack.',
					ephemeralOpts,
				);
				return null;
			case 'user-not-found':
				await event.channel.postEphemeral(
					event.user,
					`❌ No user found. Create an account with \`${result.email}\` on ${this._redirectUrl} to sign up.`,
					ephemeralOpts,
				);
				return null;
			case 'no-permission':
				await event.channel.postEphemeral(
					event.user,
					"❌ You don't have permission to use nao in this project. Please contact an administrator.",
					ephemeralOpts,
				);
				return null;
		}
	}

	private async _resolveAuthorizedUser(slackUserId: string): Promise<SlackUserAuthorization> {
		const slackUser = await this._getSlackUser(slackUserId);
		const email = slackUser?.profile?.email?.toLowerCase() || null;
		if (!email) {
			return { status: 'no-email' };
		}

		const timezone = slackUser?.tz || undefined;

		if (this._canAutoProvision(email)) {
			const project = await projectQueries.getProjectById(this.projectId);
			const projectName = project?.name ?? 'nao';
			const displayName = slackUser?.real_name || slackUser?.name || email.split('@')[0];
			const user = await ensureMessagingProviderUser({
				email,
				name: displayName,
				projectId: this.projectId,
				buildEmail: (user, temporaryPassword) =>
					buildUserAddedEmail(user, projectName, 'project', temporaryPassword),
			});
			return { status: 'authorized', user, timezone };
		}

		const user = await getUser({ email });
		if (!user) {
			return { status: 'user-not-found', email };
		}
		const role = await projectQueries.getUserRoleInProject(this.projectId, user.id);
		if (role !== 'admin' && role !== 'user' && role !== 'context_admin') {
			return { status: 'no-permission' };
		}
		return { status: 'authorized', user, timezone };
	}

	private async _isPrivateChannel(event: SlashCommandEvent): Promise<boolean> {
		try {
			const info = await event.channel.fetchMetadata();
			return info.channelVisibility === 'private';
		} catch (error) {
			logger.warn(`Failed to resolve Slack channel visibility: ${String(error)}`, {
				source: 'system',
				context: { projectId: this.projectId },
			});
			return false;
		}
	}

	private _newChatConfirmation(hadActiveChat: boolean, hasQuestion: boolean): string {
		if (hasQuestion) {
			return hadActiveChat ? '✅ Started a new chat with a fresh context.' : '✅ Started a fresh chat.';
		}
		return hadActiveChat
			? '✅ Started a new chat. Send your next message to continue with a fresh context.'
			: '✅ No active chat to reset. Send your next message to start a fresh conversation.';
	}

	private async _startNewChatFromCommand(
		event: SlashCommandEvent,
		slackChannelId: string,
		question: string,
	): Promise<void> {
		const rootMessage = await event.channel.post(`<@${event.user.userId}>: ${question}`);
		const threadId = getSlackThreadId(slackChannelId, rootMessage.id);

		await this._bot.initialize();
		const adapter = this._bot.getAdapter('slack');
		const thread = new ThreadImpl({
			adapter,
			stateAdapter: this._bot.getState(),
			id: threadId,
			channelId: deriveChannelId(adapter, threadId),
			isDM: false,
		});

		if (this._config.replyMode === 'thread') {
			await thread.subscribe();
		}

		const userMessage = new Message({
			id: rootMessage.id,
			threadId,
			text: question,
			formatted: parseMarkdown(question),
			raw: {},
			author: event.user,
			metadata: { dateSent: new Date(), edited: false },
			attachments: [],
		});

		await this._handleWorkFlow(thread, userMessage, { fetchUnseenMessages: false });
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
			if (this._autoMergeUsersEnabled) {
				const linkedUser = await this._linkEmailVarToUser(email, ctx);
				if (linkedUser) {
					ctx.user = linkedUser;
					return;
				}
			}

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

	private async _checkUserBelongsToProject(ctx: ConversationContext): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this.projectId, ctx.user!.id);
		if (role !== 'admin' && role !== 'user' && role !== 'context_admin') {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private _canAutoProvision(email: string): boolean {
		if (!this._autoCreateUsersEnabled || this._autoCreateUsersDomains.length === 0) {
			return false;
		}
		return isEmailDomainAllowed(email, this._autoCreateUsersDomains.join(','));
	}

	private async _findPotentialExistingUsers(email: string) {
		const [username] = email.split('@');
		if (!username) {
			return [];
		}

		const allowedDomains = new Set(this._autoCreateUsersDomains);
		const users = await projectQueries.listUsersWithProjectAccess(this.projectId);
		const matchingUsers = users.filter((user) => {
			const normalizedEmail = user.email.toLowerCase();
			const [candidateUsername, candidateDomain] = normalizedEmail.split('@');
			return (
				normalizedEmail !== email &&
				candidateUsername === username &&
				!!candidateDomain &&
				allowedDomains.has(candidateDomain)
			);
		});
		const userProfiles = await Promise.all(matchingUsers.map((user) => getUser({ id: user.id })));
		return userProfiles.filter((user): user is User => user !== null);
	}

	private async _linkEmailVarToUser(email: string, ctx: ConversationContext): Promise<User | null> {
		const potentialUsers = await this._findPotentialExistingUsers(email);
		const linkedUsers = email ? potentialUsers.filter((user) => user.emailVariations.includes(email)) : [];

		if (linkedUsers.length === 1) {
			return linkedUsers[0];
		}
		if (potentialUsers.length === 1) {
			return email ? await addUserEmailDomain(potentialUsers[0].id, email) : potentialUsers[0];
		}
		if (potentialUsers.length > 1) {
			await ctx.thread.post(
				'❌ Multiple existing nao users match your Slack email. Please contact an administrator.',
			);
			throw new Error('Multiple users match the Slack email username');
		}
		return null;
	}

	private async _getSlackUser(userId: string) {
		const response = await this._slackClient.users.info({ user: userId });
		return response?.user || null;
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
		const { channelId, threadTs } = parseSlackThreadId(threadId);
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
		const { channelId, threadTs } = parseSlackThreadId(threadId);
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

	private async _handleStreamAgent(
		chat: UIChat,
		ctx: ConversationContext,
		activeStream: SlackActiveStream,
	): Promise<void> {
		const { agent, stream } = await this._createAgentStream(chat, ctx);
		activeStream.agent = agent;
		if (activeStream.stopRequested) {
			agent.stop();
		}
		await this._readStreamAndUpdateSlackMessage(stream, ctx, activeStream);

		const previousCompletion = this._lastCompletionCard.get(ctx.thread.id);
		if (previousCompletion) {
			await this._slackClient.chat.delete({
				channel: previousCompletion.channelId,
				ts: previousCompletion.messageTs,
			});
		}
		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		const { channelId } = this._getSlackMessageDestination(ctx);
		const hiddenTables = countHiddenTableNotices(this._getSlackStreamState(ctx).lastDeliveredChildren);
		const messageTs = await this._postSlackCard(
			ctx,
			createCompletionCard(chatUrl, undefined, hiddenTables).children,
		);
		this._lastCompletionCard.set(ctx.thread.id, { channelId, messageTs, chatUrl, hiddenTables });

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
	): Promise<{
		agent: Awaited<ReturnType<typeof agentService.create>>;
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>;
	}> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this.projectId },
			this._modelSelection,
			{ supportsCustomCharts: false },
		);
		ctx.modelId = agent.getModelId();
		return {
			agent,
			stream: agent.stream(chat.messages, { provider: 'slack', timezone: ctx.timezone }),
		};
	}

	private async _readStreamAndUpdateSlackMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
		activeStream: SlackActiveStream,
	): Promise<StreamState> {
		const state: StreamState = {
			renderedToolCallIds: new Set(),
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
				const allText = uiMessage.parts
					.filter(
						(messagePart): messagePart is Extract<UIMessagePart, { type: 'text' }> =>
							messagePart.type === 'text',
					)
					.map((messagePart) => messagePart.text)
					.join('\n\n');
				await this._handleTextPart(allText, state, ctx);
			} else if (part.type === 'tool-execute_sql') {
				this._handleSqlPart(part, state);
			} else if (part.type === 'tool-display_chart') {
				await this._handleChartPart(part, state, ctx);
			} else if (part.type === 'tool-display_map') {
				await this._handleMapPart(part, state, ctx);
			} else if (part.type === 'tool-clarification') {
				await this._handleClarificationPart(part, ctx);
			}
		}

		await this._sendFinalText(ctx, activeStream);
		return state;
	}

	private async _handleClarificationPart(
		part: Extract<UIMessagePart, { type: 'tool-clarification' }>,
		ctx: ConversationContext,
	): Promise<void> {
		if (part.state === 'input-streaming' || !part.input) {
			return;
		}
		this._closeCurrentTextRun(ctx);
		ctx.blocks.push(...createTextBlocks(formatClarificationText(part.input.question, part.input.options)));
		await this._editConversationCard(ctx, ctx.blocks);
	}

	private async _handleTextPart(text: string, state: StreamState, ctx: ConversationContext): Promise<void> {
		this._updateTextBlock(text, ctx);
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS || !text) {
			return;
		}
		await this._editConversationCard(ctx, ctx.blocks);
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
		if (part.state !== 'output-available' || state.renderedToolCallIds.has(part.toolCallId)) {
			return;
		}
		if (!part.output?.success) {
			return;
		}
		if (displayChart.isTableInput(part.input)) {
			return;
		}
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			return;
		}
		try {
			const displaySettings = await projectQueries.getDisplaySettings(this.projectId);
			const png = generateChartImage({
				config: part.input,
				data: sqlOutput.rows,
				dateFormat: displaySettings.dateFormat,
			});
			const chartId = await chartImageQueries.saveChart(part.toolCallId, png.toString('base64'));
			state.renderedToolCallIds.add(part.toolCallId);

			if (this._config.transportMode === 'socket') {
				await this._uploadChartImageFile(png, sqlOutput.name, ctx);
				return;
			}

			const imageUrl = new URL(`c/${ctx.chatId}/${chartId}.png`, this._redirectUrl).toString();
			this._closeCurrentTextRun(ctx);
			ctx.blocks.push(createImageBlock(imageUrl));
			await this._editConversationCard(ctx, ctx.blocks);
		} catch (error) {
			logger.error(`Chart image generation failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
		}
	}

	private async _handleMapPart(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<void> {
		if (
			part.state !== 'output-available' ||
			!part.output.success ||
			state.renderedToolCallIds.has(part.toolCallId)
		) {
			return;
		}
		state.renderedToolCallIds.add(part.toolCallId);
		const png = await renderMapImage(part, state, this.projectId, {
			chatId: ctx.chatId,
			toolCallId: part.toolCallId,
		});
		if (!png) {
			await this._pushMapLinkCard(part, ctx);
			return;
		}
		try {
			const mapId = await chartImageQueries.saveChart(part.toolCallId, png.toString('base64'));
			if (this._config.transportMode === 'socket') {
				await this._uploadChartImageFile(png, part.input.title, ctx);
				return;
			}
			const imageUrl = new URL(`c/${ctx.chatId}/${mapId}.png`, this._redirectUrl).toString();
			this._closeCurrentTextRun(ctx);
			ctx.blocks.push(createImageBlock(imageUrl));
			await this._editConversationCard(ctx, ctx.blocks);
		} catch (error) {
			logger.error(`Map image rendering failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
			await this._pushMapLinkCard(part, ctx);
		}
	}

	private async _pushMapLinkCard(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		ctx: ConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available') {
			return;
		}
		try {
			const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
			this._closeCurrentTextRun(ctx);
			ctx.blocks.push(...createMapLinkCard(part.input.title, chatUrl));
			await this._editConversationCard(ctx, ctx.blocks);
		} catch (error) {
			logger.error(`Map link card failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
		}
	}

	private async _uploadChartImageFile(png: Buffer, name: string | null, ctx: ConversationContext): Promise<void> {
		const { channelId, threadTs } = parseSlackThreadId(ctx.thread.id);
		const filename = name ? `${name.toLowerCase().replace(/\s+/g, '_')}.png` : 'chart.png';
		const upload = {
			channel_id: channelId!,
			filename,
			file: png,
		};
		if (threadTs) {
			await this._slackClient.files.uploadV2({ ...upload, thread_ts: threadTs });
			return;
		}
		await this._slackClient.files.uploadV2(upload);
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

		if (state.toolGroupBlockIndex === -1 || state.toolGroupBlockIndex >= ctx.blocks.length) {
			state.toolGroupBlockIndex = ctx.blocks.length;
			ctx.blocks.push(createLiveToolCall(state.toolGroup));
		} else {
			ctx.blocks[state.toolGroupBlockIndex] = createLiveToolCall(state.toolGroup);
		}

		if (Date.now() - state.lastUpdateAt >= UPDATE_INTERVAL_MS) {
			await this._editConversationCard(ctx, ctx.blocks);
			state.lastUpdateAt = Date.now();
		}
	}

	private _flushToolGroup(state: StreamState, ctx: ConversationContext): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		if (state.toolGroupBlockIndex >= 0 && state.toolGroupBlockIndex < ctx.blocks.length) {
			ctx.blocks[state.toolGroupBlockIndex] = createSummaryToolCalls(state.toolGroup);
		}
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
		this._closeCurrentTextRun(ctx);
	}

	private _closeCurrentTextRun(ctx: ConversationContext): void {
		const streamState = this._getSlackStreamState(ctx);
		const sourceEnd = streamState.latestSourceText.length;
		const sourceText = streamState.latestSourceText.slice(streamState.textRunStart, sourceEnd);
		const emptyRunBlockIndex =
			streamState.emptyRunBlockIndex === -1 ? ctx.blocks.length : streamState.emptyRunBlockIndex;
		if (ctx.textBlockIndex !== -1 || sourceText.trim()) {
			streamState.closedTextRuns.push({
				blockIndex: ctx.textBlockIndex === -1 ? emptyRunBlockIndex : ctx.textBlockIndex,
				blockCount: ctx.textBlockIndex === -1 ? 0 : ctx.textBlockCount,
				sourceStart: streamState.textRunStart,
				sourceEnd,
			});
		}
		if (streamState.tableStateAtRunEnd) {
			streamState.tableStateAtRunStart = streamState.tableStateAtRunEnd;
		}
		streamState.tableStateAtRunEnd = null;
		streamState.emptyRunBlockIndex = -1;
		streamState.textRunStart = streamState.latestSourceText.length;
		ctx.textBlockIndex = -1;
		ctx.textBlockCount = 0;
	}

	private async _sendFinalText(ctx: ConversationContext, activeStream: SlackActiveStream): Promise<void> {
		const streamState = this._getSlackStreamState(ctx);
		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		const tableState = createSlackTableRenderState();
		const replacements: {
			blockIndex: number;
			blockCount: number;
			blocks: ReturnType<typeof createTextBlocks>;
			sourceStart: number;
			updatesOpenRunCount: boolean;
		}[] = [];
		for (const run of streamState.closedTextRuns) {
			replacements.push({
				blockIndex: run.blockIndex,
				blockCount: run.blockCount,
				blocks: createTextBlocks(streamState.latestSourceText.slice(run.sourceStart, run.sourceEnd), {
					truncation: { kind: 'link', url: chatUrl },
					tableState,
				}),
				sourceStart: run.sourceStart,
				updatesOpenRunCount: false,
			});
		}
		const openRunText = streamState.latestSourceText.slice(streamState.textRunStart);
		const emptyRunBlockIndex =
			streamState.emptyRunBlockIndex === -1 ? ctx.blocks.length : streamState.emptyRunBlockIndex;
		if (ctx.textBlockIndex !== -1 || openRunText.trim()) {
			replacements.push({
				blockIndex: ctx.textBlockIndex === -1 ? emptyRunBlockIndex : ctx.textBlockIndex,
				blockCount: ctx.textBlockIndex === -1 ? 0 : ctx.textBlockCount,
				blocks: createTextBlocks(openRunText, {
					truncation: { kind: 'link', url: chatUrl },
					tableState,
				}),
				sourceStart: streamState.textRunStart,
				updatesOpenRunCount: ctx.textBlockIndex !== -1,
			});
		}
		replacements.sort((left, right) => right.blockIndex - left.blockIndex || right.sourceStart - left.sourceStart);
		for (const replacement of replacements) {
			if (replacement.blocks.length > 0) {
				ctx.blocks.splice(replacement.blockIndex, replacement.blockCount, ...replacement.blocks);
				if (replacement.updatesOpenRunCount) {
					ctx.textBlockCount = replacement.blocks.length;
				}
			}
		}
		const finalBlocks =
			ctx.blocks.length > 0
				? ctx.blocks
				: [createTextBlock(activeStream.stopRequested ? '_Generation stopped._' : '_No response._')];
		await this._editConversationCard(ctx, finalBlocks, true);
	}

	private _updateTextBlock(
		text: string,
		ctx: ConversationContext,
		options: { truncation?: TruncationNotice } = { truncation: { kind: 'hidden' } },
	): void {
		const streamState = this._getSlackStreamState(ctx);
		streamState.latestSourceText = stripAssistantTags(text);
		const visibleText = streamState.latestSourceText.slice(streamState.textRunStart);
		const tableState = { ...streamState.tableStateAtRunStart };
		const blocks = createTextBlocks(visibleText, { ...options, tableState });
		streamState.tableStateAtRunEnd = tableState;
		if (blocks.length === 0) {
			if (visibleText.trim() && streamState.emptyRunBlockIndex === -1) {
				streamState.emptyRunBlockIndex = ctx.blocks.length;
			}
			return;
		}
		if (ctx.textBlockIndex === -1) {
			ctx.textBlockIndex = ctx.blocks.length;
			ctx.blocks.push(...blocks);
		} else {
			ctx.blocks.splice(ctx.textBlockIndex, ctx.textBlockCount, ...blocks);
		}
		ctx.textBlockCount = blocks.length;
	}

	private async _getLastAssistantMessageId(threadId: string): Promise<string | null> {
		const chat = await chatQueries.getChatBySlackThread(threadId);
		if (!chat) {
			return null;
		}
		return chatQueries.getLastAssistantMessageId(chat.id);
	}

	private _stopActiveAgent(chatId: string): boolean {
		const agent = agentService.get(chatId);
		if (!agent) {
			return false;
		}
		agent.stop();
		return true;
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
		const threadTs = options.threadId ? parseSlackThreadTs(options.threadId) : undefined;
		const result = await bot.postMessage(channelId, text, threadTs);

		if (!threadTs) {
			if (options.chatId) {
				await chatQueries.attachSlackThread(options.chatId, result.threadId);
			}
			if (options.subscribeThread ?? !!options.chatId) {
				await bot.subscribeThread(result.threadId);
			}
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
			previous.autoMergeUsersEnabled !== next.autoMergeUsersEnabled ||
			previous.modelSelection?.provider !== next.modelSelection?.provider ||
			previous.modelSelection?.modelId !== next.modelSelection?.modelId
		);
	}
}

function getSlackThreadId(channelId: string, threadTs: string): string {
	return `slack:${channelId}:${threadTs}`;
}

function parseSlackThreadId(threadId: string): { channelId?: string; threadTs?: string } {
	const [, channelId, threadTs] = threadId.split(':');
	return { channelId: channelId || undefined, threadTs: threadTs || undefined };
}

function parseSlackThreadTs(threadId: string): string | undefined {
	return parseSlackThreadId(threadId).threadTs;
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

export function isSlackNotInChannelError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const slackError = error as { data?: unknown; message?: unknown };
	const data = slackError.data;
	if (
		data &&
		typeof data === 'object' &&
		'error' in data &&
		(data as { error?: unknown }).error === 'not_in_channel'
	) {
		return true;
	}
	return typeof slackError.message === 'string' && slackError.message.toLowerCase().includes('not_in_channel');
}

export const slackService = new SlackService();
