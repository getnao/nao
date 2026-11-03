import { createGoogleChatAdapter } from '@chat-adapter/gchat';
import { createMemoryState } from '@chat-adapter/state-memory';
import { isQueryResultPart, type QueryResultPartType } from '@nao/shared/execute-sql-parts';
import { displayChart } from '@nao/shared/tools';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { type ActionEvent, Chat, Message, Thread } from 'chat';

import { messagingAgent } from '../agents/profiles/messaging';
import { generateChartImage } from '../components/generate-chart';
import { generateKpiCardImage } from '../components/generate-kpi-card';
import type { User } from '../db/abstractSchema';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import type { GoogleChatConfig } from '../queries/project-google-chat-config.queries';
import { getUser } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import type { StreamState } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { logger } from '../utils/logger';
import {
	escapeMarkdownText,
	EXCLUDED_TOOLS,
	formatClarificationText,
	formatMessagingError,
	getMessagingProviderWebhookUrl,
	renderMapImage,
} from '../utils/messaging-provider';
import { agentService } from './agent';
import { getAppName } from './branding.service';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import { GoogleChatAnswer } from './google-chat-answer';

const BOT_USER_NAME = 'nao';
const BOT_MENTION_PATTERN = new RegExp(`@${BOT_USER_NAME}\\b\\s*`, 'g');

/** Google Chat shows card images about 512px wide, so charts are drawn small enough for their labels to stay legible. */
const CHART_IMAGE_SIZE = { width: 560, height: 360 };

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

type GoogleChatConversationContext = {
	thread: Thread;
	userMessage: Message;
	config: GoogleChatConfig;
	user: User | null;
	chatId: string;
	isNewChat: boolean;
	answer: GoogleChatAnswer | null;
};

type ToolPart = Extract<UIMessagePart, { toolCallId: string }>;

type ProjectBot = {
	bot: Chat;
	configFingerprint: string;
};

class GoogleChatService {
	private _bots = new Map<string, ProjectBot>();
	private _lastAnswers = new Map<string, { answer: GoogleChatAnswer; chatUrl: string }>();

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
		const lastAnswer = this._lastAnswers.get(action.threadId);
		await lastAnswer?.answer.finish(lastAnswer.chatUrl, vote);
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

	private async _handleWorkFlow(thread: Thread, userMessage: Message, config: GoogleChatConfig): Promise<void> {
		userMessage.text = userMessage.text.replace(BOT_MENTION_PATTERN, '').trim();

		const ctx: GoogleChatConversationContext = {
			thread,
			userMessage,
			config,
			user: null,
			chatId: '',
			isNewChat: false,
			answer: null,
		};

		try {
			await this._validateUserAccess(ctx);
			await assertProjectCloudBillingAccess(ctx.config.projectId);
			ctx.answer = await GoogleChatAnswer.start(ctx.thread, await getAppName());
			await this._saveOrUpdateUserMessage(ctx);

			const [chat] = await chatQueries.getChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._streamAnswer(chat, ctx, ctx.answer);
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
		if (!ctx.answer) {
			await ctx.thread.post(errorMessage);
			return;
		}
		ctx.answer.appendText(errorMessage);
		if (ctx.chatId) {
			await this._completeAnswer(ctx, ctx.answer);
		} else {
			await ctx.answer.abandon();
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

	private async _streamAnswer(
		chat: UIChat,
		ctx: GoogleChatConversationContext,
		answer: GoogleChatAnswer,
	): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const state: StreamState = {
			renderedToolCallIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};
		this._rememberEarlierQueryResults(chat, state);

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (part) {
				await this._handlePart(part, state, ctx, answer);
			}
		}

		await this._completeAnswer(ctx, answer);
	}

	/** A chart can display a query run earlier in the conversation, so those results are kept alongside new ones. */
	private _rememberEarlierQueryResults(chat: UIChat, state: StreamState): void {
		for (const message of chat.messages) {
			for (const part of message.parts) {
				if (isQueryResultPart(part)) {
					this._handleSqlPart(part, state);
				}
			}
		}
	}

	private async _completeAnswer(ctx: GoogleChatConversationContext, answer: GoogleChatAnswer): Promise<void> {
		const chatUrl = this._chatUrl(ctx);
		const previousAnswer = this._lastAnswers.get(ctx.thread.id);
		await previousAnswer?.answer.retire(previousAnswer.chatUrl);
		await answer.finish(chatUrl);
		this._lastAnswers.set(ctx.thread.id, { answer, chatUrl });
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
		return agent.stream(chat.messages, {
			tracking: { isNewChat: ctx.isNewChat, domainHost: new URL(ctx.config.redirectUrl).host },
		});
	}

	private async _handlePart(
		part: UIMessagePart,
		state: StreamState,
		ctx: GoogleChatConversationContext,
		answer: GoogleChatAnswer,
	): Promise<void> {
		if (part.type.startsWith('tool-') && !EXCLUDED_TOOLS.includes(part.type)) {
			this._handleExplorationToolPart(part as ToolPart, state, answer);
		}
		if (part.type === 'text') {
			this._closeToolGroup(state, answer);
			answer.setText(part.text);
		} else if (isQueryResultPart(part)) {
			this._handleSqlPart(part, state);
		} else if (part.type === 'tool-display_chart') {
			await this._handleChartPart(part, state, ctx, answer);
		} else if (part.type === 'tool-display_map') {
			await this._handleMapPart(part, state, ctx, answer);
		} else if (part.type === 'tool-clarification' && part.state !== 'input-streaming' && part.input) {
			answer.setText(formatClarificationText(part.input.question, part.input.options));
		}
		answer.update();
	}

	private _handleExplorationToolPart(part: ToolPart, state: StreamState, answer: GoogleChatAnswer): void {
		if (part.state === 'input-streaming') {
			return;
		}
		state.toolGroup.set(part.toolCallId, {
			type: part.type,
			input: ('input' in part ? part.input : {}) as Record<string, string>,
			toolCallId: part.toolCallId,
		});
		answer.setToolActivity(state.toolGroup, false);
	}

	private _closeToolGroup(state: StreamState, answer: GoogleChatAnswer): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		answer.setToolActivity(state.toolGroup, true);
		state.toolGroup = new Map();
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
		answer: GoogleChatAnswer,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedToolCallIds.has(part.toolCallId)) {
			return;
		}
		if (!part.output?.success || displayChart.isTableInput(part.input)) {
			return;
		}
		state.renderedToolCallIds.add(part.toolCallId);
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			await this._appendChartLink(part.input.title, ctx, answer);
			return;
		}
		try {
			const png =
				part.input.chart_type === 'kpi_card'
					? generateKpiCardImage({ config: part.input, rows: sqlOutput.rows, width: CHART_IMAGE_SIZE.width })
					: generateChartImage({
							config: part.input,
							data: sqlOutput.rows,
							dateFormat: (await projectQueries.getDisplaySettings(ctx.config.projectId)).dateFormat,
							...CHART_IMAGE_SIZE,
						});
			answer.addImage(await this._saveImage(part.toolCallId, png, ctx));
		} catch (error) {
			logger.error(`Chart image generation failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
			await this._appendChartLink(part.input.title, ctx, answer);
		}
	}

	/** A chart that cannot be drawn as an image still points to the interactive one in nao instead of vanishing. */
	private async _appendChartLink(
		title: string | undefined,
		ctx: GoogleChatConversationContext,
		answer: GoogleChatAnswer,
	): Promise<void> {
		const label = title ? `**${escapeMarkdownText(title)}**: ` : '';
		answer.appendText(`📊 ${label}[view the chart in ${await getAppName()}](${this._chatUrl(ctx)})`);
	}

	private async _handleMapPart(
		part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
		state: StreamState,
		ctx: GoogleChatConversationContext,
		answer: GoogleChatAnswer,
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
		try {
			if (png) {
				answer.addImage(await this._saveImage(part.toolCallId, png, ctx));
				return;
			}
		} catch (error) {
			logger.error(`Map image rendering failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
		}
		const appName = await getAppName();
		answer.appendText(
			`🗺️ **${escapeMarkdownText(part.input.title)}**: [view the interactive map in ${appName}](${this._chatUrl(ctx)})`,
		);
	}

	private async _saveImage(toolCallId: string, png: Buffer, ctx: GoogleChatConversationContext): Promise<string> {
		const imageId = await chartImageQueries.saveChart(toolCallId, png.toString('base64'));
		return new URL(`c/${ctx.chatId}/${imageId}.png`, ctx.config.redirectUrl).toString();
	}

	private _chatUrl(ctx: GoogleChatConversationContext): string {
		return new URL(ctx.chatId, ctx.config.redirectUrl).toString();
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
