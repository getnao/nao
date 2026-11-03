import { createGoogleChatAdapter } from '@chat-adapter/gchat';
import { createMemoryState } from '@chat-adapter/state-memory';
import { stripAssistantTags } from '@nao/shared';
import { isQueryResultPart, type QueryResultPartType } from '@nao/shared/execute-sql-parts';
import { displayChart } from '@nao/shared/tools';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { type ActionEvent, Card, Chat, Message, SentMessage, Thread } from 'chat';

import { messagingAgent } from '../agents/profiles/messaging';
import { generateChartImage } from '../components/generate-chart';
import type { User } from '../db/abstractSchema';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import type { GoogleChatConfig } from '../queries/project-google-chat-config.queries';
import { getUser } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { logger } from '../utils/logger';
import {
	createCompletionCard,
	createImageBlock,
	createLiveToolCall,
	createMapLinkCard,
	createStopButtonCard,
	createSummaryToolCalls,
	createTextBlock,
	EXCLUDED_TOOLS,
	formatClarificationText,
	formatMessagingError,
	getMessagingProviderWebhookUrl,
	renderMapImage,
} from '../utils/messaging-provider';
import { agentService } from './agent';
import { getAppName } from './branding.service';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';

const BOT_USER_NAME = 'nao';
const BOT_MENTION_PATTERN = new RegExp(`@${BOT_USER_NAME}\\b\\s*`, 'g');

/** Google Chat allows about one message write per second in a space, so streamed edits are spaced out. */
const UPDATE_INTERVAL_MS = 1500;

interface GoogleChatRawSpace {
	name?: string;
	type?: string;
	spaceType?: string;
}

interface GoogleChatRawEvent {
	chat?: {
		user?: { email?: string };
		messagePayload?: { message?: { sender?: { email?: string } } };
		buttonClickedPayload?: { user?: { email?: string }; space?: GoogleChatRawSpace };
	};
}

type GoogleChatConversationContext = ConversationContext & {
	config: GoogleChatConfig;
};

type ProjectBot = {
	bot: Chat;
	configFingerprint: string;
};

class GoogleChatService {
	private _bots = new Map<string, ProjectBot>();
	private _lastCompletionCards = new Map<string, { card: SentMessage; chatUrl: string }>();

	public getWebhooks(config: GoogleChatConfig) {
		const configFingerprint = this._fingerprint(config);
		const existing = this._bots.get(config.projectId);
		if (existing?.configFingerprint === configFingerprint) {
			return existing.bot.webhooks;
		}
		const bot = this._createBot(config);
		this._bots.set(config.projectId, { bot, configFingerprint });
		return bot.webhooks;
	}

	public stopProject(projectId: string): void {
		this._bots.delete(projectId);
	}

	private _fingerprint(config: GoogleChatConfig): string {
		return JSON.stringify([
			config.credentials.client_email,
			config.credentials.private_key,
			config.googleCloudProjectNumber,
			config.redirectUrl,
			config.modelSelection?.provider,
			config.modelSelection?.modelId,
		]);
	}

	private _createBot(config: GoogleChatConfig): Chat {
		const bot = new Chat({
			userName: BOT_USER_NAME,
			adapters: {
				gchat: createGoogleChatAdapter({
					credentials: config.credentials,
					userName: BOT_USER_NAME,
					endpointUrl: getMessagingProviderWebhookUrl(config.redirectUrl, 'google-chat', config.projectId),
					googleChatProjectNumber: config.googleCloudProjectNumber,
					workspaceAddOnServiceAccountEmail: getWorkspaceAddOnServiceAccountEmail(
						config.googleCloudProjectNumber,
					),
				}),
			},
			state: createMemoryState(),
		});

		bot.onNewMention(async (thread, message) => {
			if (message.author.isBot) {
				return;
			}
			await this._handleWorkFlow(thread, message, config);
		});

		bot.onAction('stop_generation', async (event) => {
			const action = await this._findAuthorizedActionChat(event, config);
			if (action) {
				agentService.get(action.chatId)?.stop();
			}
		});

		bot.onAction('feedback_positive', async (event) => {
			await this._recordFeedback(event, config, 'up');
		});

		bot.onAction('feedback_negative', async (event) => {
			await this._recordFeedback(event, config, 'down');
		});

		return bot;
	}

	private async _recordFeedback(event: ActionEvent, config: GoogleChatConfig, vote: 'up' | 'down'): Promise<void> {
		const action = await this._findAuthorizedActionChat(event, config);
		if (!action) {
			return;
		}
		const messageId = await chatQueries.getLastAssistantMessageId(action.chatId);
		if (!messageId) {
			return;
		}
		await feedbackQueries.upsertFeedback({ messageId, vote });
		await this._updateCompletionCardVote(action.threadId, vote);
	}

	/** Resolves the chat a card button belongs to, provided the person who clicked it may use this project. */
	private async _findAuthorizedActionChat(
		event: ActionEvent,
		config: GoogleChatConfig,
	): Promise<{ chatId: string; threadId: string } | null> {
		const raw = event.raw as GoogleChatRawEvent;
		const email = raw?.chat?.buttonClickedPayload?.user?.email || raw?.chat?.user?.email;
		try {
			await this._getProjectMember(email, config);
		} catch (error) {
			if (error instanceof GoogleChatAccessError) {
				return null;
			}
			throw error;
		}
		const threadId = toConversationThreadId(event.threadId, raw?.chat?.buttonClickedPayload?.space);
		const chat = await chatQueries.getChatByGoogleChatThread(threadId, config.projectId);
		return chat ? { chatId: chat.id, threadId } : null;
	}

	private async _updateCompletionCardVote(threadId: string, vote: 'up' | 'down'): Promise<void> {
		const completion = this._lastCompletionCards.get(threadId);
		if (!completion) {
			return;
		}
		const appName = await getAppName();
		await completion.card.edit(createCompletionCard(completion.chatUrl, { vote, appName }));
	}

	private async _handleWorkFlow(thread: Thread, userMessage: Message, config: GoogleChatConfig): Promise<void> {
		userMessage.text = userMessage.text.replace(BOT_MENTION_PATTERN, '').trim();

		const ctx: GoogleChatConversationContext = {
			thread,
			userMessage,
			config,
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

		try {
			await this._validateUserAccess(ctx);
			await assertProjectCloudBillingAccess(ctx.config.projectId);
			ctx.convMessage = await ctx.thread.post(`✨ ${await getAppName()} is answering...`);
			await this._saveOrUpdateUserMessage(ctx);

			const [chat] = await chatQueries.getChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx);
		} catch (error) {
			await this._reportError(error, ctx);
		}
	}

	private async _reportError(error: unknown, ctx: GoogleChatConversationContext): Promise<void> {
		if (error instanceof GoogleChatAccessError) {
			await ctx.thread.post(error.message);
			return;
		}
		logger.error(`Google Chat message handling failed: ${String(error)}`, {
			source: 'system',
			context: { projectId: ctx.config.projectId, chatId: ctx.chatId },
		});
		const errorMessage = formatMessagingError(error);
		if (ctx.convMessage) {
			ctx.blocks.push(createTextBlock(errorMessage));
			await ctx.convMessage.edit(Card({ children: ctx.blocks }));
		} else {
			await ctx.thread.post(errorMessage);
		}
	}

	private async _validateUserAccess(ctx: GoogleChatConversationContext): Promise<void> {
		const raw = ctx.userMessage.raw as GoogleChatRawEvent;
		const email = raw?.chat?.user?.email || raw?.chat?.messagePayload?.message?.sender?.email;
		ctx.user = await this._getProjectMember(email, ctx.config);
	}

	private async _getProjectMember(rawEmail: string | undefined, config: GoogleChatConfig): Promise<User> {
		if (!rawEmail) {
			throw new GoogleChatAccessError('❌ Could not retrieve your email address from Google Chat.');
		}

		const email = rawEmail.toLowerCase();
		const user = await getUser({ email });
		if (!user) {
			throw new GoogleChatAccessError(
				`❌ No user found. Create an account with \`${email}\` on ${config.redirectUrl} to sign up.`,
			);
		}

		const role = await projectQueries.getUserRoleInProject(config.projectId, user.id);
		if (role !== 'admin' && role !== 'user' && role !== 'context_admin') {
			throw new GoogleChatAccessError(
				`❌ You don't have permission to use ${await getAppName()} in this project. Please contact an administrator.`,
			);
		}
		return user;
	}

	private async _saveOrUpdateUserMessage(ctx: GoogleChatConversationContext): Promise<void> {
		const text = ctx.userMessage.text;

		const existingChat = await chatQueries.getChatByGoogleChatThread(ctx.thread.id, ctx.config.projectId);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				senderUserId: ctx.user!.id,
				source: 'google-chat',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
			return;
		}

		const title = createChatTitle({ text });
		const [createdChat] = await chatQueries.createChat(
			{ title, userId: ctx.user!.id, projectId: ctx.config.projectId, googleChatThreadId: ctx.thread.id },
			{ text, source: 'google-chat' },
		);
		ctx.chatId = createdChat.id;
		ctx.isNewChat = true;
	}

	private async _handleStreamAgent(chat: UIChat, ctx: GoogleChatConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const stopCard = await ctx.thread.post(createStopButtonCard());

		try {
			await this._readStreamAndUpdateMessage(stream, ctx);
		} finally {
			await stopCard.delete();
		}

		await this._lastCompletionCards.get(ctx.thread.id)?.card.delete();
		const chatUrl = new URL(ctx.chatId, ctx.config.redirectUrl).toString();
		const appName = await getAppName();
		const card = await ctx.thread.post(createCompletionCard(chatUrl, { appName }));
		this._lastCompletionCards.set(ctx.thread.id, { card, chatUrl });
	}

	private async _createAgentStream(
		chat: UIChat,
		ctx: GoogleChatConversationContext,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: ctx.config.projectId },
			ctx.config.modelSelection,
			messagingAgent('google-chat'),
			{ billingAccessVerifiedProjectId: ctx.config.projectId },
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, {
			timezone: ctx.timezone,
			tracking: { isNewChat: ctx.isNewChat, domainHost: new URL(ctx.config.redirectUrl).host },
		});
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: GoogleChatConversationContext,
	): Promise<void> {
		const state: StreamState = {
			renderedToolCallIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (part) {
				await this._handlePart(part, state, ctx);
			}
		}

		await this._sendFinalText(ctx);
	}

	private async _handlePart(
		part: UIMessagePart,
		state: StreamState,
		ctx: GoogleChatConversationContext,
	): Promise<void> {
		if (part.type.startsWith('tool-') && !EXCLUDED_TOOLS.includes(part.type)) {
			await this._handleCollapsibleToolPart(part as Extract<UIMessagePart, { toolCallId: string }>, state, ctx);
		}
		if (part.type === 'text') {
			this._flushToolGroup(state, ctx);
			await this._handleTextPart(part, state, ctx);
		} else if (isQueryResultPart(part)) {
			this._handleSqlPart(part, state);
		} else if (part.type === 'tool-display_chart') {
			await this._handleChartPart(part, state, ctx);
		} else if (part.type === 'tool-display_map') {
			await this._handleMapPart(part, state, ctx);
		} else if (part.type === 'tool-clarification') {
			this._handleClarificationPart(part, ctx);
		}
	}

	private _handleClarificationPart(
		part: Extract<UIMessagePart, { type: 'tool-clarification' }>,
		ctx: ConversationContext,
	): void {
		if (part.state === 'input-streaming' || !part.input) {
			return;
		}
		const text = formatClarificationText(part.input.question, part.input.options);
		this._updateTextBlock(text, ctx);
	}

	private async _handleTextPart(
		part: Extract<UIMessagePart, { type: 'text' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<void> {
		this._updateTextBlock(part.text, ctx);
		if (!part.text) {
			return;
		}
		await this._editIfDue(state, ctx);
	}

	private _handleSqlPart(part: Extract<UIMessagePart, { type: QueryResultPartType }>, state: StreamState): void {
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
		ctx: GoogleChatConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedToolCallIds.has(part.toolCallId)) {
			return;
		}
		if (!part.output?.success || displayChart.isTableInput(part.input)) {
			return;
		}
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			return;
		}
		try {
			const displaySettings = await projectQueries.getDisplaySettings(ctx.config.projectId);
			const png = generateChartImage({
				config: part.input,
				data: sqlOutput.rows,
				dateFormat: displaySettings.dateFormat,
			});
			state.renderedToolCallIds.add(part.toolCallId);
			await this._pushImage(part.toolCallId, png, ctx);
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
		ctx: GoogleChatConversationContext,
	): Promise<void> {
		if (
			part.state !== 'output-available' ||
			!part.output.success ||
			state.renderedToolCallIds.has(part.toolCallId)
		) {
			return;
		}
		state.renderedToolCallIds.add(part.toolCallId);
		const png = await renderMapImage(part, state, ctx.config.projectId, {
			chatId: ctx.chatId,
			toolCallId: part.toolCallId,
		});
		if (!png) {
			await this._pushMapLinkCard(part, ctx);
			return;
		}
		try {
			await this._pushImage(part.toolCallId, png, ctx);
		} catch (error) {
			logger.error(`Map image rendering failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
			await this._pushMapLinkCard(part, ctx);
		}
	}

	private async _pushImage(toolCallId: string, png: Buffer, ctx: GoogleChatConversationContext): Promise<void> {
		const imageId = await chartImageQueries.saveChart(toolCallId, png.toString('base64'));
		const imageUrl = new URL(`c/${ctx.chatId}/${imageId}.png`, ctx.config.redirectUrl).toString();
		ctx.textBlockIndex = -1;
		ctx.blocks.push(createImageBlock(imageUrl));
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
	}

	private async _pushMapLinkCard(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		ctx: GoogleChatConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available') {
			return;
		}
		try {
			const chatUrl = new URL(ctx.chatId, ctx.config.redirectUrl).toString();
			const appName = await getAppName();
			ctx.textBlockIndex = -1;
			ctx.blocks.push(...createMapLinkCard(part.input.title, chatUrl, appName));
			await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
		} catch (error) {
			logger.error(`Map link card failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
		}
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

		await this._editIfDue(state, ctx);
	}

	private async _editIfDue(state: StreamState, ctx: ConversationContext): Promise<void> {
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS) {
			return;
		}
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
		state.lastUpdateAt = Date.now();
	}

	private _flushToolGroup(state: StreamState, ctx: ConversationContext): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		ctx.blocks[state.toolGroupBlockIndex] = createSummaryToolCalls(state.toolGroup);
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
		ctx.textBlockIndex = -1;
	}

	private async _sendFinalText(ctx: ConversationContext): Promise<void> {
		if (ctx.blocks.length === 0) {
			return;
		}
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
	}

	private _updateTextBlock(text: string, ctx: ConversationContext): void {
		const block = createTextBlock(stripAssistantTags(text));
		if (ctx.textBlockIndex === -1) {
			ctx.textBlockIndex = ctx.blocks.length;
			ctx.blocks.push(block);
		} else {
			ctx.blocks[ctx.textBlockIndex] = block;
		}
	}
}

/**
 * A card click in a direct message carries the clicked message's thread, while the conversation itself is keyed
 * by the whole DM space, so the click is mapped back to the conversation's thread id.
 */
function toConversationThreadId(clickThreadId: string, space: GoogleChatRawSpace | undefined): string {
	const isDirectMessage = space?.type === 'DM' || space?.spaceType === 'DIRECT_MESSAGE';
	if (!isDirectMessage || !space?.name) {
		return clickThreadId;
	}
	return `gchat:${space.name}:dm`;
}

/** A message the sender should see as-is, rather than as a generic processing error. */
class GoogleChatAccessError extends Error {}

/** Workspace Add-on Chat apps sign their webhooks with this per-project identity instead of the Chat system account. */
function getWorkspaceAddOnServiceAccountEmail(googleCloudProjectNumber: string | undefined): string | undefined {
	if (!googleCloudProjectNumber) {
		return undefined;
	}
	return `service-${googleCloudProjectNumber}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`;
}

export const googleChatService = new GoogleChatService();
