import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useEffect, useCallback, useRef } from 'react';
import { Chat as Agent, useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemoObject } from './useMemoObject';
import { usePrevRef } from './use-prev';
import { useLocalStorage } from './use-local-storage';
import { useChatId } from './use-chat-id';
import type { FileUIPart, InferUIMessageChunk } from 'ai';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from '@nao/backend/chat';
import type { MentionOption } from 'prompt-mentions';
import type { ImageUploadData, LlmSelectedModel } from '@nao/shared/types';
import { messageQueueStore } from '@/stores/chat-message-queue';
import { chatActivityStore } from '@/stores/chat-activity';
import { useChatQuery, useSetChat } from '@/queries/use-chat-query';
import { trpc } from '@/main';
import { agentService } from '@/services/agents';
import {
	checkIsAgentRunning,
	extractImagesFromMessage,
	getLastUserMessageIdx,
	getTextFromUserMessageOrThrow,
	NEW_CHAT_ID,
	parseBudgetError,
} from '@/lib/ai';
import { useSetChatList } from '@/queries/use-chat-list-query';
import { createLocalStorage } from '@/lib/local-storage';
import { getActiveProjectId } from '@/lib/active-project';

export interface AgentHelpers {
	chatId: string | undefined;
	messages: UIMessage[];
	setMessages: UseChatHelpers<UIMessage>['setMessages'];
	queueOrSendMessage: (args: SendMessageArgs) => Promise<void>;
	editMessage: (args: { messageId: string; text: string }) => Promise<void | UIMessage>;
	submitQueuedMessageNow: (messageId: string) => Promise<void>;
	status: UseChatHelpers<UIMessage>['status'];
	isRunning: boolean;
	isLoadingMessages: boolean;
	stopAgent: () => Promise<void>;
	error: Error | undefined;
	clearError: UseChatHelpers<UIMessage>['clearError'];
	selectedModel: LlmSelectedModel | null;
	setSelectedModel: React.Dispatch<React.SetStateAction<LlmSelectedModel | null>>;
	setMentions: (mentions: MentionOption[]) => void;
}

export interface SendMessageArgs {
	text: string;
	images?: ImageUploadData[];
}

export const selectedModelStorage = createLocalStorage<LlmSelectedModel>('nao-selected-model');

export const useAgent = ({ disableNavigation = false }: { disableNavigation?: boolean } = {}): AgentHelpers => {
	const navigate = useNavigate();
	const chatId = useChatId();
	const chat = useChatQuery({ chatId });

	const [selectedModel, setSelectedModel] = useLocalStorage(selectedModelStorage);
	const setChat = useSetChat();
	const setChatList = useSetChatList();

	const chatIdRef = useRef(chatId);
	chatIdRef.current = chatId;
	const selectedModelRef = useRef<LlmSelectedModel | null>(null);
	selectedModelRef.current = selectedModel;
	const mentionsRef = useRef<MentionOption[]>([]);

	const setMentions = useCallback((mentions: MentionOption[]) => {
		mentionsRef.current = mentions;
	}, []);

	const agentInstance = useMemo(() => {
		let agentId = chatId ?? NEW_CHAT_ID;

		if (!disableNavigation) {
			const existingAgent = agentService.getAgent(agentId);
			if (existingAgent) {
				return existingAgent;
			}
		}

		const handleAgentDataPart = (dataPart: InferUIMessageChunk<UIMessage>, agent: Agent<UIMessage>) => {
			if (dataPart.type === 'data-newChat') {
				const newChat = dataPart.data;
				messageQueueStore.moveQueue(agentId, newChat.id);
				agentService.moveAgent(agentId, newChat.id);
				agentId = newChat.id;
				setChat({ chatId: newChat.id }, { ...newChat, messages: [] });
				setChatList((old) => ({ chats: [newChat, ...(old?.chats || [])] }));
				if (!disableNavigation) {
					navigate({ to: '/$chatId', params: { chatId: newChat.id }, state: { fromMessageSend: true } });
				}
				return;
			}

			if (dataPart.type === 'data-chatTitleUpdate') {
				const { title } = dataPart.data;
				setChat({ chatId: agentId }, (prev) => (prev ? { ...prev, title } : prev));
				setChatList((old) => ({
					chats: (old?.chats ?? []).map((c) => (c.id === agentId ? { ...c, title } : c)),
				}));
				return;
			}

			if (dataPart.type === 'data-newUserMessage') {
				const { newId } = dataPart.data;
				const lastUserMessageIndex = getLastUserMessageIdx(agent.messages);
				agent.messages = agent.messages.map((message, idx) =>
					idx === lastUserMessageIndex ? { ...message, id: newId } : message,
				);
			}
		};

		const newAgent = new Agent<UIMessage>({
			transport: new DefaultChatTransport({
				api: '/api/agent',
				prepareSendMessagesRequest: ({ body, messages }) => {
					const messageToSend = messages.at(-1);
					if (!messageToSend) {
						throw new Error('No message to send.');
					}

					const mentions = mentionsRef.current;
					mentionsRef.current = [];
					const images = extractImagesFromMessage(messageToSend);
					return {
						headers: getActiveProjectId() ? { 'x-nao-project-id': getActiveProjectId()! } : undefined,
						body: {
							...body,
							chatId: agentId === NEW_CHAT_ID ? undefined : agentId,
							message: {
								text: getTextFromUserMessageOrThrow(messageToSend),
								images: images.length > 0 ? images : undefined,
							},
							model: selectedModelRef.current ?? undefined,
							mentions: mentions.length > 0 ? mentions : undefined,
							timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						},
					};
				},
			}),
			onData: (dataPart) => handleAgentDataPart(dataPart, newAgent),
			onFinish: ({ isAbort, isError, isDisconnect }) => {
				const canSendNextMessage = !isAbort && !isError && !isDisconnect;
				const next = canSendNextMessage ? messageQueueStore.dequeue(agentId) : undefined;
				if (next) {
					mentionsRef.current = next.mentions;
					const files = imagesToFileUIParts(next.images);
					newAgent.sendMessage({ text: next.text, files: files.length > 0 ? files : undefined });
				} else {
					chatActivityStore.setRunning(agentId, false);
					if (chatIdRef.current !== agentId) {
						chatActivityStore.setUnread(agentId, true);
						agentService.disposeAgent(agentId);
					}
				}
			},
			onError: () => {
				messageQueueStore.clear(agentId);
			},
		});

		if (disableNavigation) {
			return newAgent;
		}

		return agentService.registerAgent(agentId, newAgent);
	}, [chatId, disableNavigation, navigate, setChat, setChatList]);

	const { status, error, clearError, sendMessage, setMessages, messages } = useChat({ chat: agentInstance });

	const stopAgentMutation = useMutation(trpc.chat.stop.mutationOptions());
	const isRunning = checkIsAgentRunning({ status });

	useEffect(() => {
		if (chatId) {
			chatActivityStore.setRunning(chatId, isRunning);
		}
	}, [chatId, isRunning]);

	useEffect(() => {
		if (chatId) {
			chatActivityStore.setUnread(chatId, false);
		}
	}, [chatId]);

	useEffect(() => {
		if (!parseBudgetError(error)) {
			return;
		}
		const lastMsg = messages.at(-1);
		if (lastMsg?.role === 'user') {
			const nextMessages = messages.slice(0, -1);
			setMessages(nextMessages);
			if (chatIdRef.current) {
				setChat({ chatId: chatIdRef.current }, (prev) => (prev ? { ...prev, messages: nextMessages } : prev));
			}
		}
	}, [error]); // eslint-disable-line react-hooks/exhaustive-deps

	const stopAgent = useCallback(async () => {
		if (!chatId) {
			return;
		}

		agentInstance.stop(); // Stop the agent instance to instantly stop reading the stream
		await stopAgentMutation.mutateAsync({ chatId });
	}, [chatId, agentInstance, stopAgentMutation.mutateAsync]); // eslint-disable-line

	const handleSendMessage = useCallback<UseChatHelpers<UIMessage>['sendMessage']>(
		async (...args) => {
			clearError();
			return sendMessage(...args);
		},
		[sendMessage, clearError],
	);

	const queueOrSendMessage = useCallback(
		async ({ text, images }: SendMessageArgs) => {
			if (!text.trim() && !images?.length) {
				return;
			}

			if (!isRunning) {
				const files = imagesToFileUIParts(images);
				return handleSendMessage({
					text: text || 'Describe this image',
					files: files.length > 0 ? files : undefined,
				});
			}

			const mentions = [...mentionsRef.current];
			mentionsRef.current = [];

			messageQueueStore.enqueue(chatIdRef.current, {
				text,
				mentions,
				images,
			});
		},
		[isRunning, handleSendMessage],
	);

	const submitQueuedMessageNow = useCallback(
		async (messageId: string) => {
			messageQueueStore.promoteToFront(chatIdRef.current, messageId);
			await stopAgent();
			const next = messageQueueStore.dequeue(chatIdRef.current ?? NEW_CHAT_ID);
			if (next) {
				mentionsRef.current = next.mentions;
				await handleSendMessage({ text: next.text });
			}
		},
		[stopAgent, handleSendMessage],
	);

	const editMessage = useCallback(
		async ({ messageId, text }: { messageId: string; text: string }) => {
			const trimmedText = text.trim();
			if (!trimmedText || isRunning) {
				return;
			}

			const messageIndex = messages.findIndex((message) => message.id === messageId);
			if (messageIndex === -1) {
				return;
			}

			setMessages(messages.slice(0, messageIndex));
			return handleSendMessage({ text: trimmedText }, { body: { messageToEditId: messageId } });
		},
		[messages, setMessages, isRunning, handleSendMessage],
	);

	return useMemoObject({
		chatId,
		messages,
		setMessages,
		queueOrSendMessage,
		editMessage,
		submitQueuedMessageNow,
		status,
		isRunning,
		isLoadingMessages: chat.isLoading,
		stopAgent,
		error,
		clearError,
		selectedModel,
		setSelectedModel,
		setMentions,
	});
};

/** Sync the messages between the useChat hook and the query client. */
export const useSyncMessages = ({ agent }: { agent: AgentHelpers }) => {
	const chatId = useChatId();
	const chat = useChatQuery({ chatId });
	const setChat = useSetChat();

	useEffect(() => {
		if (chat.data?.messages && !agent.isRunning) {
			agent.setMessages(chat.data.messages);
		}
	}, [chat.data?.messages]); // eslint-disable-line react-hooks/exhaustive-deps

	const agentMessagesRef = useRef(agent.messages);
	agentMessagesRef.current = agent.messages;
	const chatDataRef = useRef(chat.data);
	chatDataRef.current = chat.data;

	useEffect(() => {
		if (!agent.isRunning) {
			return;
		}
		const base = chatDataRef.current;
		setChat({ chatId }, (prev) => {
			const src = prev ?? base;
			return src ? { ...src, messages: agent.messages } : prev;
		});
	}, [setChat, agent.messages, chatId, agent.isRunning]);

	const wasRunningRef = useRef(false);
	useEffect(() => {
		if (wasRunningRef.current && !agent.isRunning) {
			const base = chatDataRef.current;
			setChat({ chatId }, (prev) => {
				const src = prev ?? base;
				return src ? { ...src, messages: agentMessagesRef.current } : prev;
			});
		}
		wasRunningRef.current = agent.isRunning;
	}, [agent.isRunning, setChat, chatId]);
};

function imagesToFileUIParts(images?: ImageUploadData[]): FileUIPart[] {
	if (!images?.length) {
		return [];
	}
	return images.map((img) => ({
		type: 'file' as const,
		mediaType: img.mediaType,
		url: `data:${img.mediaType};base64,${img.data}`,
	}));
}

/** Dispose inactive agents to free up memory */
export const useDisposeInactiveAgents = () => {
	const chatId = useParams({ strict: false }).chatId;
	const prevChatIdRef = usePrevRef(chatId);

	useEffect(() => {
		if (!prevChatIdRef.current || chatId === prevChatIdRef.current) {
			return;
		}

		const agentIdToDispose = prevChatIdRef.current;
		const agent = agentService.getAgent(agentIdToDispose);
		if (!agent) {
			return;
		}

		const isRunning = checkIsAgentRunning(agent);
		if (!isRunning) {
			agentService.disposeAgent(agentIdToDispose);
		}
	}, [chatId, prevChatIdRef]);
};
