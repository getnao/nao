import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { Chat as Agent, useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCurrent } from './useCurrent';
import { useMemoObject } from './useMemoObject';
import { usePrevRef } from './use-prev';
import { useLocalStorage } from './use-local-storage';
import type { InferUIMessageChunk } from 'ai';
import type { ScrollToBottom, ScrollToBottomOptions } from 'use-stick-to-bottom';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from '@nao/backend/chat';
import type { MentionOption } from 'prompt-mentions';
import type ChatSelectedModel from '@/types/ai';
import { useChatQuery, useSetChat } from '@/queries/use-chat-query';
import { trpc } from '@/main';
import { agentService } from '@/services/agents';
import { checkIsAgentRunning, getLastUserMessageIdx, getTextFromUserMessageOrThrow } from '@/lib/ai';
import { useSetChatList } from '@/queries/use-chat-list-query';
import { createLocalStorage } from '@/lib/local-storage';

export interface AgentHelpers {
	messages: UIMessage[];
	setMessages: UseChatHelpers<UIMessage>['setMessages'];
	sendMessage: UseChatHelpers<UIMessage>['sendMessage'];
	editMessage: (args: { messageId: string; text: string }) => Promise<void | UIMessage>;
	status: UseChatHelpers<UIMessage>['status'];
	isRunning: boolean;
	isLoadingMessages: boolean;
	stopAgent: () => Promise<void>;
	registerScrollDown: (fn: ScrollToBottom) => { dispose: () => void };
	error: Error | undefined;
	clearError: UseChatHelpers<UIMessage>['clearError'];
	selectedModel: ChatSelectedModel | null;
	setSelectedModel: React.Dispatch<React.SetStateAction<ChatSelectedModel | null>>;
	setMentions: (mentions: MentionOption[]) => void;
}

const selectedModelStorage = createLocalStorage<ChatSelectedModel>('nao-selected-model');

export const useAgent = (): AgentHelpers => {
	const navigate = useNavigate();
	const { chatId } = useParams({ strict: false });
	const chat = useChatQuery({ chatId });
	const chatIdRef = useCurrent(chatId);
	const scrollDownService = useScrollDownCallbackService();

	const [selectedModel, setSelectedModel] = useLocalStorage(selectedModelStorage);
	const selectedModelRef = useCurrent(selectedModel);
	const mentionsRef = useRef<MentionOption[]>([]);
	const setChat = useSetChat();
	const setChatList = useSetChatList();

	const setMentions = useCallback((mentions: MentionOption[]) => {
		mentionsRef.current = mentions;
	}, []);

	const agentInstance = useMemo(() => {
		let agentId = chatId ?? 'new-chat';

		const existingAgent = agentService.getAgent(agentId);
		if (existingAgent) {
			return existingAgent;
		}

		const handleAgentDataPart = (dataPart: InferUIMessageChunk<UIMessage>, agent: Agent<UIMessage>) => {
			if (dataPart.type === 'data-newChat') {
				const newChat = dataPart.data;
				agentService.moveAgent(agentId, newChat.id);
				agentId = newChat.id;
				setChat({ chatId: newChat.id }, { ...newChat, messages: [] });
				setChatList((old) => ({ chats: [newChat, ...(old?.chats || [])] }));
				navigate({ to: '/$chatId', params: { chatId: newChat.id }, state: { fromMessageSend: true } });
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
					return {
						body: {
							...body,
							chatId: agentId === 'new-chat' ? undefined : agentId,
							message: {
								text: getTextFromUserMessageOrThrow(messageToSend),
							},
							model: selectedModelRef.current ?? undefined,
							mentions: mentions.length > 0 ? mentions : undefined,
						},
					};
				},
			}),
			onData: (dataPart) => handleAgentDataPart(dataPart, newAgent),
			onFinish: () => {
				if (chatIdRef.current !== agentId) {
					agentService.disposeAgent(agentId);
				}
			},
		});

		return agentService.registerAgent(agentId, newAgent);
	}, [chatId, navigate, setChat, setChatList, chatIdRef, selectedModelRef]);

	const { status, error, clearError, sendMessage, setMessages, messages } = useChat({ chat: agentInstance });

	const stopAgentMutation = useMutation(trpc.chat.stop.mutationOptions());

	const stopAgent = useCallback(async () => {
		if (!chatId) {
			return;
		}

		agentInstance.stop(); // Stop the agent instance to instantly stop reading the stream
		await stopAgentMutation.mutateAsync({ chatId });
	}, [chatId, agentInstance, stopAgentMutation.mutateAsync]); // eslint-disable-line

	const isRunning = checkIsAgentRunning({ status });

	const handleSendMessage = useCallback(
		async (...args: Parameters<UseChatHelpers<UIMessage>['sendMessage']>) => {
			if (isRunning) {
				return;
			}
			clearError();
			scrollDownService.scrollDown({ animation: 'smooth' });
			return sendMessage(...args);
		},
		[isRunning, sendMessage, clearError, scrollDownService.scrollDown], // eslint-disable-line
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
		[messages, setMessages, isRunning, handleSendMessage, scrollDownService.scrollDown, clearError], // eslint-disable-line
	);

	return useMemoObject({
		messages,
		setMessages,
		sendMessage: handleSendMessage,
		editMessage,
		status,
		isRunning,
		isLoadingMessages: chat.isLoading,
		stopAgent,
		registerScrollDown: scrollDownService.register,
		error,
		clearError,
		selectedModel,
		setSelectedModel,
		setMentions,
	});
};

/** Sync the messages between the useChat hook and the query client. */
export const useSyncMessages = ({ agent }: { agent: AgentHelpers }) => {
	const { chatId } = useParams({ strict: false });
	const chat = useChatQuery({ chatId });
	const setChat = useSetChat();

	// Sync the agent's messages with the fetched ones
	useEffect(() => {
		if (chat.data?.messages && !agent.isRunning) {
			agent.setMessages(chat.data.messages);
		}
	}, [chat.data?.messages, agent.isRunning, agent.setMessages]); // eslint-disable-line

	// Sync the fetched messages with the agent's
	useEffect(() => {
		if (agent.isRunning) {
			setChat({ chatId }, (prev) => (!prev ? prev : { ...prev, messages: agent.messages }));
		}
	}, [setChat, agent.messages, chatId, agent.isRunning]);
};

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

const useScrollDownCallbackService = () => {
	const scrollDownCallbackRef = useRef<ScrollToBottom | null>(null);

	const scrollDown = useCallback(
		(options?: ScrollToBottomOptions) => {
			if (scrollDownCallbackRef.current) {
				scrollDownCallbackRef.current(options);
			}
		},
		[scrollDownCallbackRef],
	);

	const register = useCallback((callback: ScrollToBottom) => {
		scrollDownCallbackRef.current = callback;
		return {
			dispose: () => {
				scrollDownCallbackRef.current = null;
			},
		};
	}, []);

	return {
		scrollDown,
		register,
	};
};
