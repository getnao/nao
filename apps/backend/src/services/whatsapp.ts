import { createMemoryState } from '@chat-adapter/state-memory';
import { createRedisState } from '@chat-adapter/state-redis';
import { createWhatsAppAdapter } from '@chat-adapter/whatsapp';
import { CITATION_TAG_REGEX } from '@nao/shared';
import type { LlmSelectedModel } from '@nao/shared/types';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Attachment, Chat, Message, Thread } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import { env } from '../env';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as imageQueries from '../queries/image.queries';
import * as projectQueries from '../queries/project.queries';
import { WhatsappConfig } from '../queries/project-whatsapp-config.queries';
import * as projectWhatsappLinkQueries from '../queries/project-whatsapp-link.queries';
import { get as getUser, getByMessagingProviderCode } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { buildImageUrl } from '../utils/image';
import { logger } from '../utils/logger';
import { EXCLUDED_TOOLS } from '../utils/messaging-provider';
import { agentService } from './agent';
import { posthog, PostHogEvent } from './posthog';
import * as transcribeService from './transcribe.service';

const SUPPORTED_WHATSAPP_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const WHATSAPP_STATE_KEY_PREFIX = 'nao:whatsapp:state';

const createState = (projectId: string) => {
	if (!env.REDIS_URL) {
		return createMemoryState();
	}

	return createRedisState({
		url: env.REDIS_URL,
		keyPrefix: `${WHATSAPP_STATE_KEY_PREFIX}:${projectId}`,
	});
};

class WhatsappService {
	private _bot: Chat | null = null;
	private _projectId: string = '';
	private _redirectUrl: string = '';
	private _currentAccessToken: string = '';
	private _currentAppSecret: string = '';
	private _currentPhoneNumberId: string = '';
	private _currentVerifyToken: string = '';
	private _modelSelection: LlmSelectedModel | undefined = undefined;

	constructor() {}

	public getWebhooks(config: WhatsappConfig) {
		if (this._configChanged(config)) {
			this._initialize(config);
		}
		return this._bot?.webhooks;
	}

	private _configChanged(config: WhatsappConfig): boolean {
		return (
			this._currentAccessToken !== config.accessToken ||
			this._currentAppSecret !== config.appSecret ||
			this._currentPhoneNumberId !== config.phoneNumberId ||
			this._currentVerifyToken !== config.verifyToken ||
			this._projectId !== config.projectId ||
			this._redirectUrl !== config.redirectUrl ||
			this._modelSelection?.provider !== config.modelSelection?.provider ||
			this._modelSelection?.modelId !== config.modelSelection?.modelId
		);
	}

	private _initialize(config: WhatsappConfig): void {
		this._currentAccessToken = config.accessToken;
		this._currentAppSecret = config.appSecret;
		this._currentPhoneNumberId = config.phoneNumberId;
		this._currentVerifyToken = config.verifyToken;
		this._projectId = config.projectId;
		this._redirectUrl = config.redirectUrl;
		this._modelSelection = config.modelSelection;

		this._bot = new Chat({
			userName: 'nao',
			adapters: {
				whatsapp: createWhatsAppAdapter({
					accessToken: config.accessToken,
					appSecret: config.appSecret,
					phoneNumberId: config.phoneNumberId,
					verifyToken: config.verifyToken,
				}),
			},
			state: createState(config.projectId),
		});

		this._bot.onNewMention(async (thread, message) => {
			await this._handleIncomingMessage(thread, message);
		});

		this._bot.onNewMessage(/.*/, async (thread, message) => {
			await this._handleIncomingMessage(thread, message);
		});
	}

	private async _handleIncomingMessage(thread: Thread, message: Message): Promise<void> {
		const normalizedText = (message.text ?? '').trim();
		if (normalizedText === '/login' || normalizedText.startsWith('/login ')) {
			await this._handleLoginCommand(thread, message);
			return;
		}
		if (normalizedText === '/new') {
			await this._handleNewCommand(thread, message);
			return;
		}
		await this._handleWorkFlow(thread, message);
	}

	private async _handleWorkFlow(thread: Thread, userMessage: Message): Promise<void> {
		this._markAsReadWithTypingIndicator(userMessage.id);

		const ctx = this._createConversationContext(thread, userMessage);

		try {
			await this._validateUserAccess(ctx);
			await this._saveOrUpdateUserMessage(ctx);

			const [chat] = await chatQueries.loadChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx);
		} catch (error) {
			const errorMessage = `❌ An error occurred while processing your message. ${error instanceof Error ? error.message : 'Unknown error'}.`;
			await ctx.thread.post(errorMessage);
		}
	}

	private _markAsReadWithTypingIndicator(messageId: string): void {
		const url = `https://graph.facebook.com/v21.0/${this._currentPhoneNumberId}/messages`;
		fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this._currentAccessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				status: 'read',
				message_id: messageId,
				typing_indicator: { type: 'text' },
			}),
		}).catch(() => {});
	}

	private async _handleLoginCommand(thread: Thread, message: Message): Promise<void> {
		const whatsappId = this._getWhatsappId(message);
		if (!whatsappId) {
			await thread.post('❌ Could not retrieve your WhatsApp identity.');
			return;
		}

		const code = message.text.trim().slice('/login'.length).trim();
		if (!code) {
			await thread.post(
				'❌ Missing linking code. Open nao, go to Settings > Project > WhatsApp, copy your Linking Code, then send `/login <your-linking-code>` here.',
			);
			return;
		}

		const user = await getByMessagingProviderCode(code);
		if (!user) {
			await thread.post(
				'❌ Invalid linking code. Copy the latest Linking Code from Settings > Project > WhatsApp and send `/login <your-linking-code>` again.',
			);
			return;
		}

		const existingLinkForWhatsapp = await projectWhatsappLinkQueries.getLinkedWhatsappUser(
			this._projectId,
			whatsappId,
		);
		if (existingLinkForWhatsapp && existingLinkForWhatsapp.userId !== user.id) {
			await thread.post(
				'❌ This WhatsApp account is already linked to another nao user in this project. Unlink it first before linking it again.',
			);
			return;
		}

		const existingLinksForUser = await projectWhatsappLinkQueries.listLinkedWhatsappUsersByUserId(
			this._projectId,
			user.id,
		);
		const isAlreadyLinkedToThisWhatsapp = existingLinksForUser.some((link) => link.whatsappUserId === whatsappId);
		if (!isAlreadyLinkedToThisWhatsapp && existingLinksForUser.length > 0) {
			await thread.post(
				'❌ This nao user is already linked to a different WhatsApp account. Open nao, go to Settings > Project > WhatsApp, unlink the current account, then try again.',
			);
			return;
		}

		await projectWhatsappLinkQueries.upsertLinkedWhatsappUser({
			projectId: this._projectId,
			whatsappUserId: whatsappId,
			userId: user.id,
		});
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	private _getWhatsappId(message: Message): string | null {
		return message.author.userId || null;
	}

	private async _handleNewCommand(thread: Thread, userMessage: Message): Promise<void> {
		this._markAsReadWithTypingIndicator(userMessage.id);

		const ctx = this._createConversationContext(thread, userMessage);

		try {
			await this._validateUserAccess(ctx);
		} catch {
			return;
		}

		const existingChat = await chatQueries.getChatByWhatsappThread(thread.id);
		if (!existingChat) {
			await thread.post('✅ No active chat to reset. Send your next message to start a fresh conversation.');
			return;
		}

		agentService.get(existingChat.id)?.stop();
		await chatQueries.clearWhatsappThread(thread.id);
		await thread.post('✅ Started a new chat. Send your next message to continue with a fresh context.');
	}

	private _createConversationContext(thread: Thread, userMessage: Message): ConversationContext {
		return {
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
	}

	private async _validateUserAccess(ctx: ConversationContext): Promise<void> {
		await this._getUser(ctx);
		await this._checkUserBelongsToProject(ctx);
	}

	private async _getUser(ctx: ConversationContext): Promise<void> {
		const whatsappId = this._getWhatsappId(ctx.userMessage);
		if (!whatsappId) {
			throw new Error('Could not retrieve user identity from WhatsApp');
		}

		const link = await projectWhatsappLinkQueries.getLinkedWhatsappUser(this._projectId, whatsappId);
		if (!link) {
			await ctx.thread.post(
				'👋 Your WhatsApp account is not linked yet. In nao, open Settings > Project > WhatsApp, copy your Linking Code, then send `/login <your-linking-code>` here. Example: `/login abc12345`',
			);
			throw new Error('User not linked');
		}

		const user = await getUser({ id: link.userId });
		if (!user) {
			await projectWhatsappLinkQueries.deleteLinkedWhatsappUser(this._projectId, whatsappId);
			await ctx.thread.post(
				'❌ Your previous link is no longer valid. Copy your current Linking Code from Settings > Project > WhatsApp and send `/login <your-linking-code>` again to relink.',
			);
			throw new Error('User not found');
		}
		ctx.user = user;
	}

	private async _checkUserBelongsToProject(ctx: ConversationContext): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this._projectId, ctx.user!.id);
		if (role !== 'admin' && role !== 'user') {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(ctx: ConversationContext): Promise<void> {
		const { text, imageParts, titleText } = await this._resolveUserMessageContent(ctx);
		const threadId = ctx.thread.id;

		const existingChat = await chatQueries.getChatByWhatsappThread(threadId);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }, ...imageParts],
				chatId: existingChat.id,
				source: 'whatsapp',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
		} else {
			const title = createChatTitle({ text: titleText });
			const [createdChat] = await chatQueries.createChat(
				{ title, userId: ctx.user!.id, projectId: this._projectId, whatsappThreadId: threadId },
				{ text, source: 'whatsapp' },
				imageParts,
			);
			ctx.chatId = createdChat.id;
			ctx.isNewChat = true;
		}
	}

	private async _resolveUserMessageContent(
		ctx: ConversationContext,
	): Promise<{ text: string; imageParts: UIMessagePart[]; titleText: string }> {
		const text = await this._resolveUserMessageText(ctx);
		const imageParts = await this._resolveImageParts(ctx);

		return {
			text,
			imageParts,
			titleText: text.trim() || (imageParts.length > 0 ? 'Image message' : text),
		};
	}

	private async _resolveUserMessageText(ctx: ConversationContext): Promise<string> {
		const audioAttachment = this._getAudioAttachment(ctx.userMessage);
		if (!audioAttachment) {
			return ctx.userMessage.text ?? '';
		}

		const agentSettings = await projectQueries.getAgentSettings(this._projectId);
		if (!agentSettings?.transcribe?.enabled) {
			await ctx.thread.post(
				'❌ Voice note transcription is not enabled for this project. Ask an admin to enable it in Settings > Models.',
			);
			throw new Error('Voice note transcription is disabled');
		}

		try {
			const audio = await this._encodeAttachmentAsBase64(audioAttachment);
			const transcript = (await transcribeService.transcribeAudio(this._projectId, audio)).trim();
			if (!transcript) {
				throw new Error('Transcription returned empty text');
			}
			return transcript;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			await ctx.thread.post(`❌ I could not transcribe your voice note. ${message}`);
			throw new Error(`Failed to transcribe audio message: ${message}`);
		}
	}

	private async _resolveImageParts(ctx: ConversationContext): Promise<UIMessagePart[]> {
		const imageAttachments = this._getImageAttachments(ctx.userMessage);
		if (imageAttachments.length === 0) {
			return [];
		}

		try {
			const savedImages = await imageQueries.saveImages(
				await Promise.all(
					imageAttachments.map(async (attachment) => {
						const mediaType = attachment.mimeType?.toLowerCase();
						if (!mediaType) {
							throw new Error('Image MIME type is unavailable');
						}
						if (!SUPPORTED_WHATSAPP_IMAGE_MEDIA_TYPES.has(mediaType)) {
							throw new Error(
								`Unsupported image format (${mediaType}). Supported formats: PNG, JPEG, GIF, and WEBP.`,
							);
						}

						return {
							mediaType,
							data: await this._encodeAttachmentAsBase64(attachment),
						};
					}),
				),
			);

			return savedImages.map(({ id, mediaType }) => ({
				type: 'file',
				mediaType,
				url: buildImageUrl(id),
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			await ctx.thread.post(`❌ I could not process your image attachment. ${message}`);
			throw new Error(`Failed to process image attachment: ${message}`);
		}
	}

	private _getAudioAttachment(message: Message): Attachment | undefined {
		const placeholderText = (message.text ?? '').trim();
		if (placeholderText !== '[Voice message]' && placeholderText !== '[Audio message]') {
			return undefined;
		}

		return message.attachments.find((attachment) => attachment.type === 'audio');
	}

	private _getImageAttachments(message: Message): Attachment[] {
		return message.attachments.filter(
			(attachment) =>
				attachment.type === 'image' ||
				(attachment.type === 'file' && attachment.mimeType?.startsWith('image/')),
		);
	}

	private async _encodeAttachmentAsBase64(attachment: Attachment): Promise<string> {
		if (attachment.data instanceof Buffer) {
			return attachment.data.toString('base64');
		}

		if (attachment.data instanceof Blob) {
			const buffer = Buffer.from(await attachment.data.arrayBuffer());
			return buffer.toString('base64');
		}

		if (attachment.fetchData) {
			const buffer = await attachment.fetchData();
			return buffer.toString('base64');
		}

		throw new Error('WhatsApp attachment data is unavailable');
	}

	private async _handleStreamAgent(chat: UIChat, ctx: ConversationContext): Promise<void> {
		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		const stream = await this._createAgentStream(chat, ctx, chatUrl);

		const { finalText, chartUrls } = await this._readStreamAndUpdateMessage(stream, ctx);

		if (finalText) {
			await ctx.thread.post(finalText);
		}

		for (const url of chartUrls) {
			await this._sendWhatsAppImage(ctx.thread.id, url);
		}

		posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
			project_id: this._projectId,
			chat_id: ctx.chatId,
			model_id: ctx.modelId,
			is_new_chat: ctx.isNewChat,
			source: 'whatsapp',
			domain_host: new URL(this._redirectUrl).host,
		});
	}

	private async _createAgentStream(
		chat: UIChat,
		ctx: ConversationContext,
		chatUrl: string,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this._projectId },
			this._modelSelection,
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'whatsapp', timezone: ctx.timezone, chatUrl });
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
	): Promise<{ finalText: string; chartUrls: string[] }> {
		const state: StreamState = {
			renderedChartIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};

		const chartUrls: string[] = [];
		let lastMessage: UIMessage | null = null;

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			lastMessage = uiMessage;
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (!part) {
				continue;
			}
			if (part.type.startsWith('tool-') && !EXCLUDED_TOOLS.includes(part.type)) {
				this._trackToolCall(part as Extract<UIMessagePart, { toolCallId: string }>, state);
			}
			if (part.type === 'tool-execute_sql') {
				this._handleSqlPart(part, state);
			} else if (part.type === 'tool-display_chart') {
				const url = await this._handleChartPart(part, state, ctx);
				if (url) {
					chartUrls.push(url);
				}
			}
		}

		const finalText = (lastMessage?.parts ?? [])
			.filter((p): p is Extract<UIMessagePart, { type: 'text' }> => p.type === 'text')
			.map((p) => p.text.replace(CITATION_TAG_REGEX, ''))
			.join('\n\n');

		return { finalText, chartUrls };
	}

	private async _handleChartPart(
		part: Extract<UIMessagePart, { type: 'tool-display_chart' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<string | null> {
		if (part.state !== 'output-available' || state.renderedChartIds.has(part.toolCallId)) {
			return null;
		}
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			return null;
		}
		try {
			const png = generateChartImage({ config: part.input, data: sqlOutput.rows });
			const chartId = await chartImageQueries.saveChart(part.toolCallId, png.toString('base64'));
			state.renderedChartIds.add(part.toolCallId);
			return new URL(`c/${ctx.chatId}/${chartId}.png`, this._redirectUrl).toString();
		} catch (error) {
			logger.error(`Chart image generation failed: ${String(error)}`, {
				source: 'system',
				context: { chatId: ctx.chatId, toolCallId: part.toolCallId },
			});
			return null;
		}
	}

	private async _sendWhatsAppImage(threadId: string, imageUrl: string): Promise<void> {
		const userWaId = threadId.split(':')[2];
		if (!userWaId) {
			return;
		}
		const url = `https://graph.facebook.com/v21.0/${this._currentPhoneNumberId}/messages`;
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this._currentAccessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					messaging_product: 'whatsapp',
					recipient_type: 'individual',
					to: userWaId,
					type: 'image',
					image: { link: imageUrl },
				}),
			});
		} catch (error) {
			logger.error(`Failed to send WhatsApp image: ${error instanceof Error ? error.message : String(error)}`, {
				source: 'system',
				context: { threadId, imageUrl },
			});
			return;
		}
		if (!response.ok) {
			const body = await response.text();
			logger.error(`Failed to send WhatsApp image: ${response.status}`, {
				source: 'system',
				context: { body },
			});
		}
	}

	private _trackToolCall(part: Extract<UIMessagePart, { toolCallId: string }>, state: StreamState): void {
		if (part.state === 'input-streaming') {
			return;
		}
		const entry: ToolCallEntry = {
			type: part.type,
			input: ('input' in part ? part.input : {}) as Record<string, string>,
			toolCallId: part.toolCallId,
		};
		state.toolGroup.set(part.toolCallId, entry);
	}

	private _handleSqlPart(part: Extract<UIMessagePart, { type: 'tool-execute_sql' }>, state: StreamState): void {
		if (part.state !== 'output-available') {
			return;
		}
		if (part.output.id && part.output.data) {
			state.sqlOutputs.set(part.output.id, { name: part.input.name ?? null, rows: part.output.data });
		}
	}
}

export const whatsappService = new WhatsappService();
