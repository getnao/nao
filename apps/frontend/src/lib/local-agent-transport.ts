import { readUIMessageStream } from 'ai';
import type { UIMessage } from '@nao/backend/chat';
import type { LocalAgentTurn } from '@nao/backend/local-agent';
import type { ChatTransport, UIMessageChunk } from 'ai';
import type { LocalAgentEvent, LocalAgentSelection } from '@/lib/local-agent';

import { getProjectRequestHeaders } from '@/lib/active-project';
import { extractDocumentPathsFromMessage, extractImagesFromMessage, getTextFromUserMessageOrThrow } from '@/lib/ai';
import { startLocalAgentTurn, stopLocalAgentTurn } from '@/lib/local-agent';

type SendMessagesOptions = Parameters<ChatTransport<UIMessage>['sendMessages']>[0];

const TURNS_URL = '/api/local-agent/turns';

/**
 * Runs a chat turn on the user's own subscription through the nao desktop app. The server saves
 * the user's message and serves the tools; the desktop app's Claude answers, and the answer is
 * saved back on the server once the turn ends.
 */
export class LocalAgentChatTransport implements ChatTransport<UIMessage> {
	constructor(
		private readonly _getSelection: () => LocalAgentSelection,
		private readonly _getChatId: () => string | undefined,
	) {}

	async sendMessages(options: SendMessagesOptions): Promise<ReadableStream<UIMessageChunk>> {
		const userMessage = options.messages.at(-1);
		if (!userMessage) {
			throw new Error('No message to send.');
		}
		assertNoAttachments(userMessage);
		const selection = this._getSelection();
		const turn = await requestTurn({
			chatId: this._getChatId(),
			messageToEditId: readMessageToEditId(options.body),
			message: { text: getTextFromUserMessageOrThrow(userMessage) },
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});
		return streamTurn(turn, selection, getTextFromUserMessageOrThrow(userMessage), options.abortSignal);
	}

	async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
		return null;
	}
}

function streamTurn(
	turn: LocalAgentTurn,
	selection: LocalAgentSelection,
	prompt: string,
	abortSignal: AbortSignal | undefined,
): ReadableStream<UIMessageChunk> {
	const assistantMessageId = crypto.randomUUID();
	const recorder = recordAssistantMessage(assistantMessageId);
	let turnId: string | undefined;
	let isReaderGone = false;

	return new ReadableStream<UIMessageChunk>({
		start: async (controller) => {
			const enqueue = (chunk: UIMessageChunk) => {
				if (!isReaderGone) {
					controller.enqueue(chunk);
				}
			};
			enqueue({ type: 'start', messageId: assistantMessageId });
			if (turn.newChat) {
				enqueue({ type: 'data-newChat', data: turn.newChat });
			}
			enqueue({ type: 'data-newUserMessage', data: { newId: turn.userMessageId } });

			const finished = new Promise<void>((resolve) => {
				const onEvent = async (event: LocalAgentEvent) => {
					if (event.type === 'chunk') {
						enqueue(event.chunk);
						recorder.push(event.chunk);
						return;
					}
					await completeTurn(turn.chatId, await recorder.finish(), event).catch((error) =>
						enqueue({ type: 'error', errorText: describeError(error) }),
					);
					enqueue({ type: 'finish' });
					resolve();
				};
				startLocalAgentTurn(
					{
						provider: selection.provider,
						model: selection.model,
						prompt,
						history: turn.history,
						systemPrompt: turn.systemPrompt,
						mcp: { url: new URL(turn.mcp.url, window.location.origin).toString(), token: turn.mcp.token },
					},
					onEvent,
				)
					.then((id) => {
						turnId = id;
						if (abortSignal?.aborted) {
							void stopLocalAgentTurn(id);
						}
					})
					.catch((error) => {
						enqueue({ type: 'error', errorText: describeError(error) });
						enqueue({ type: 'finish' });
						resolve();
					});
			});
			abortSignal?.addEventListener('abort', () => turnId && void stopLocalAgentTurn(turnId), { once: true });

			await finished;
			if (!isReaderGone) {
				controller.close();
			}
		},
		cancel: () => {
			isReaderGone = true;
			if (turnId) {
				void stopLocalAgentTurn(turnId);
			}
		},
	});
}

/** Rebuilds the assistant message from the chunks, as the chat does, to save it once the turn ends. */
function recordAssistantMessage(messageId: string) {
	let input: ReadableStreamDefaultController<UIMessageChunk> | undefined;
	const stream = new ReadableStream<UIMessageChunk>({
		start: (controller) => {
			input = controller;
		},
	});
	const lastMessage = (async () => {
		let message: UIMessage | undefined;
		for await (const update of readUIMessageStream<UIMessage>({ stream })) {
			message = update;
		}
		return message;
	})();
	input?.enqueue({ type: 'start', messageId });

	return {
		push: (chunk: UIMessageChunk) => {
			if (chunk.type !== 'error') {
				input?.enqueue(chunk);
			}
		},
		finish: async (): Promise<UIMessage> => {
			input?.close();
			return (await lastMessage) ?? { id: messageId, role: 'assistant', parts: [] };
		},
	};
}

async function requestTurn(body: Record<string, unknown>): Promise<LocalAgentTurn> {
	return postJson<LocalAgentTurn>(TURNS_URL, body);
}

async function completeTurn(
	chatId: string,
	message: UIMessage,
	outcome: Extract<LocalAgentEvent, { type: 'done' }>,
): Promise<void> {
	await postJson(`${TURNS_URL}/complete`, {
		chatId,
		message: { id: message.id, role: 'assistant', parts: message.parts },
		modelId: outcome.modelId,
		stopReason: outcome.stopReason,
		errorMessage: outcome.errorMessage,
		usage: outcome.usage,
	});
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json', ...getProjectRequestHeaders() },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(readErrorMessage(payload) ?? `The request failed (${response.status}).`);
	}
	return payload as T;
}

function assertNoAttachments(message: UIMessage): void {
	if (extractImagesFromMessage(message).length > 0 || extractDocumentPathsFromMessage(message).length > 0) {
		throw new Error('Attachments are not supported with your Claude Code yet. Pick a nao model to send them.');
	}
}

function readMessageToEditId(body: object | undefined): string | undefined {
	const messageToEditId = (body as { messageToEditId?: unknown } | undefined)?.messageToEditId;
	return typeof messageToEditId === 'string' ? messageToEditId : undefined;
}

function readErrorMessage(payload: unknown): string | undefined {
	if (typeof payload === 'object' && payload !== null) {
		const { error, message } = payload as { error?: unknown; message?: unknown };
		if (typeof message === 'string') {
			return message;
		}
		if (typeof error === 'string') {
			return error;
		}
	}
	return undefined;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Sends a turn to the server's agent, or to the desktop app when the user picked their own subscription. */
export class SwitchingChatTransport implements ChatTransport<UIMessage> {
	constructor(
		private readonly _server: ChatTransport<UIMessage>,
		private readonly _local: ChatTransport<UIMessage>,
		private readonly _runsLocally: () => boolean,
	) {}

	sendMessages(options: SendMessagesOptions): Promise<ReadableStream<UIMessageChunk>> {
		return this._runsLocally() ? this._local.sendMessages(options) : this._server.sendMessages(options);
	}

	reconnectToStream(
		options: Parameters<ChatTransport<UIMessage>['reconnectToStream']>[0],
	): Promise<ReadableStream<UIMessageChunk> | null> {
		return this._server.reconnectToStream(options);
	}
}
