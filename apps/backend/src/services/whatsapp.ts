import { createMemoryState } from '@chat-adapter/state-memory';
import { createWhatsAppAdapter } from '@chat-adapter/whatsapp';
import { CITATION_TAG_REGEX } from '@nao/shared';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Chat, Message, Thread } from 'chat';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { WhatsappConfig } from '../queries/project-whatsapp-config.queries';
import { get as getUser, getByMessagingProviderCode } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import { createSummaryToolCalls, createWhatsAppCompletionCard, EXCLUDED_TOOLS } from '../utils/messaging-provider';
import { agentService, ModelSelection } from './agent';
import { posthog, PostHogEvent } from './posthog';

class WhatsappService {
	private _bot: Chat | null = null;
	private _projectId: string = '';
	private _redirectUrl: string = '';
	private _currentAccessToken: string = '';
	private _currentAppSecret: string = '';
	private _currentPhoneNumberId: string = '';
	private _currentVerifyToken: string = '';
	private _modelSelection: ModelSelection | undefined = undefined;
	private _userByWhatsappId: Map<string, string> = new Map();

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
			state: createMemoryState(),
		});

		this._bot.onNewMention(async (thread, message) => {
			if (message.text.startsWith('/login')) {
				await this._handleLoginCommand(thread, message);
				return;
			}
			await this._handleWorkFlow(thread, message);
		});

		this._bot.onNewMessage(/.*/, async (thread, message) => {
			if (message.text.startsWith('/login')) {
				await this._handleLoginCommand(thread, message);
				return;
			}
			await this._handleWorkFlow(thread, message);
		});
	}

	private async _handleWorkFlow(thread: Thread, userMessage: Message): Promise<void> {
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

	private async _handleLoginCommand(thread: Thread, message: Message): Promise<void> {
		const whatsappId = this._getWhatsappId(message);
		if (!whatsappId) {
			await thread.post('❌ Could not retrieve your WhatsApp identity.');
			return;
		}

		const code = message.text.replace(/^\/login\s+/, '').trim();
		if (!code) {
			await thread.post('❌ Invalid code. Usage: `/login <your-code>`');
			return;
		}

		const user = await getByMessagingProviderCode(code);
		if (!user) {
			await thread.post('❌ Invalid linking code. Check your code in the project settings.');
			return;
		}

		this._userByWhatsappId.set(whatsappId, user.email.toLowerCase());
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	private _getWhatsappId(message: Message): string | null {
		return message.author.userId || null;
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

		const email = this._userByWhatsappId.get(whatsappId);
		if (!email) {
			await ctx.thread.post(
				'👋 Welcome! Send `/login <your-code>` to link your account. Find your code in project settings.',
			);
			throw new Error('User not linked');
		}

		const user = await getUser({ email });
		if (!user) {
			this._userByWhatsappId.delete(whatsappId);
			await ctx.thread.post(`❌ No account found for ${email}. Send \`/login\` again with the correct code.`);
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
		const text = ctx.userMessage.text;
		const threadId = ctx.thread.id;

		const existingChat = await chatQueries.getChatByWhatsappThread(threadId);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				source: 'whatsapp',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
		} else {
			const title = createChatTitle({ text });
			const [createdChat] = await chatQueries.createChat(
				{ title, userId: ctx.user!.id, projectId: this._projectId, whatsappThreadId: threadId },
				{ text, source: 'whatsapp' },
			);
			ctx.chatId = createdChat.id;
			ctx.isNewChat = true;
		}
	}

	private async _handleStreamAgent(chat: UIChat, ctx: ConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);

		const { finalText } = await this._readStreamAndUpdateMessage(stream, ctx);

		if (finalText) {
			await ctx.thread.post(finalText);
		}

		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		await ctx.thread.post(createWhatsAppCompletionCard(chatUrl));

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
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this._projectId },
			this._modelSelection,
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'whatsapp', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
	): Promise<{ finalText: string }> {
		const state: StreamState = {
			renderedChartIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};

		let finalText = '';

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (!part) {
				continue;
			}
			if (part.type.startsWith('tool-') && !EXCLUDED_TOOLS.includes(part.type)) {
				this._trackToolCall(part as Extract<UIMessagePart, { toolCallId: string }>, state);
			}
			if (part.type === 'text') {
				finalText = part.text.replace(CITATION_TAG_REGEX, '');
			} else if (part.type === 'tool-execute_sql') {
				this._handleSqlPart(part, state);
			}
		}

		if (state.toolGroup.size > 0) {
			const summary = createSummaryToolCalls(state.toolGroup);
			await ctx.thread.post('content' in summary ? summary.content : '');
		}

		return { finalText };
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
