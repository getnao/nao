import { Chat as Agent, useChat } from '@ai-sdk/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatId } from './use-chat-id';
import { useLocalStorage } from './use-local-storage';
import { usePrevRef } from './use-prev';
import { useMemoObject } from './useMemoObject';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from '@nao/backend/chat';
import type { ImageUploadData } from '@nao/shared/attachments';
import type { CitationData, LlmSelectedModel } from '@nao/shared/types';
import type { DocumentAttachment } from '@/lib/attachments';
import type { FileUIPart, InferUIMessageChunk } from 'ai';
import type { MentionOption } from 'prompt-mentions';

import { getActiveProjectId } from '@/lib/active-project';
import {
	checkIsAgentRunning,
	extractDocumentPathsFromMessage,
	extractImagesFromMessage,
	getLastUserMessageIdx,
	getMessageDocuments,
	getMessageImages,
	getMessageText,
	getTextFromUserMessageOrThrow,
	NEW_CHAT_ID,
	parseBudgetError,
	resolveImagesFromMessage,
} from '@/lib/ai';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';
import { useChatQuery, useSetChat } from '@/queries/use-chat-query';
import { agentService } from '@/services/agents';
import { chatActivityStore } from '@/stores/chat-activity';
import { cancellingMessageIdStore } from '@/stores/chat-cancelling-message';
import { editedMessageIdStore } from '@/stores/chat-edited-message';
import { chatInputRestoreStore } from '@/stores/chat-input-restore';
import { messageQueueStore } from '@/stores/chat-message-queue';

export interface AgentHelpers {
	chatId: string | undefined;
	setMessages: UseChatHelpers<UIMessage>['setMessages'];
	queueOrSendMessage: (args: SendMessageArgs) => Promise<void>;
	editMessage: (
		args: { messageId: string; text: string } & Pick<SendMessageArgs, 'images' | 'documents'>,
	) => Promise<void | UIMessage>;
	resendMessage: (args: { messageId: string }) => Promise<void | UIMessage>;
	switchMessageVersion: (args: { messageId: string }) => Promise<void>;
	submitQueuedMessageNow: (messageId: string) => Promise<void>;
	status: UseChatHelpers<UIMessage>['status'];
	isRunning: boolean;
	isLoadingMessages: boolean;
	cancelAgent: () => Promise<void>;
	error: Error | undefined;
	clearError: UseChatHelpers<UIMessage>['clearError'];
	selectedModel: LlmSelectedModel | null;
	setSelectedModel: React.Dispatch<React.SetStateAction<LlmSelectedModel | null>>;
	setMentions: (mentions: MentionOption[]) => void;
	adminMode: boolean;
	setAdminMode: (enabled: boolean) => void;
	isReadonly?: boolean;
}

export interface AgentState extends AgentHelpers {
	messages: UIMessage[];
}

export interface SendMessageArgs {
	text: string;
	images?: ImageUploadData[];
	/** Files already uploaded to permanent storage, so the message only has to name them. */
	documents?: DocumentAttachment[];
	citation?: CitationData;
}

export const selectedModelStorage = createLocalStorage<LlmSelectedModel>('nao-selected-model');

const agentCitationStore = new WeakMap<Agent<UIMessage>, CitationData | undefined>();
/** Admin mode captured at send time, so an ack-time toggle cannot mislabel the message. */
const agentAdminModeStore = new WeakMap<Agent<UIMessage>, boolean>();

interface AgentSendRefs {
	adminModeRef: { current: boolean };
	selectedModelRef: { current: LlmSelectedModel | null };
	mentionsRef: { current: MentionOption[] };
}
const agentSendRefsStore = new WeakMap<Agent<UIMessage>, AgentSendRefs>();

export const useAgent = ({ disableNavigation = false }: { disableNavigation?: boolean } = {}): AgentState => {
	const navigate = useNavigate();
	const chatId = useChatId();
	const chat = useChatQuery({ chatId });

	const [selectedModel, setSelectedModel] = useLocalStorage(selectedModelStorage);
	const setChat = useSetChat();
	const queryClient = useQueryClient();

	const chatIdRef = useRef(chatId);
	chatIdRef.current = chatId;
	const selectedModelRef = useRef<LlmSelectedModel | null>(null);
	selectedModelRef.current = selectedModel;
	const mentionsRef = useRef<MentionOption[]>([]);
	const [adminMode, setAdminModeState] = useState(false);
	const adminModeRef = useRef(false);
	/** Set to the server id of a chat that was just created, so the upcoming chatId change is treated as the same conversation continuing rather than opening a different chat. */
	const continuationChatIdRef = useRef<string | undefined>(undefined);

	const setMentions = useCallback((mentions: MentionOption[]) => {
		mentionsRef.current = mentions;
	}, []);

	const setAdminMode = useCallback((enabled: boolean) => {
		adminModeRef.current = enabled;
		setAdminModeState(enabled);
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
				if (agentId !== newChat.id) {
					messageQueueStore.moveQueue(agentId, newChat.id);
					agentService.moveAgent(agentId, newChat.id);
					agentId = newChat.id;
					continuationChatIdRef.current = newChat.id;
					setChat({ chatId: newChat.id }, { ...newChat, messages: [] });
					if (!disableNavigation) {
						navigate({ to: '/$chatId', params: { chatId: newChat.id }, state: { fromMessageSend: true } });
					}
				}
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				return;
			}

			if (dataPart.type === 'data-chatTitleUpdate') {
				const { title } = dataPart.data;
				setChat({ chatId: agentId }, (prev) => (prev ? { ...prev, title } : prev));
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				return;
			}

			if (dataPart.type === 'data-newUserMessage') {
				const { newId } = dataPart.data;
				const citation = agentCitationStore.get(newAgent);
				agentCitationStore.delete(newAgent);
				const sentInAdminMode = agentAdminModeStore.get(newAgent) ?? false;
				agentAdminModeStore.delete(newAgent);
				const lastUserMessageIndex = getLastUserMessageIdx(agent.messages);
				agent.messages = agent.messages.map((message, idx) =>
					idx === lastUserMessageIndex
						? {
								...message,
								id: newId,
								...(citation && { citation }),
								...(sentInAdminMode && { source: 'admin' as const }),
							}
						: message,
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

					const liveRefs = agentSendRefsStore.get(newAgent);
					const activeMentionsRef = liveRefs?.mentionsRef ?? mentionsRef;
					const activeSelectedModelRef = liveRefs?.selectedModelRef ?? selectedModelRef;
					const activeAdminModeRef = liveRefs?.adminModeRef ?? adminModeRef;

					const mentions = activeMentionsRef.current;
					activeMentionsRef.current = [];
					const citation = agentCitationStore.get(newAgent);
					const images = extractImagesFromMessage(messageToSend);
					const documents = extractDocumentPathsFromMessage(messageToSend);
					const adminModeAtSend = activeAdminModeRef.current;
					agentAdminModeStore.set(newAgent, adminModeAtSend);
					return {
						headers: getActiveProjectId() ? { 'x-nao-project-id': getActiveProjectId()! } : undefined,
						body: {
							...body,
							chatId: agentId === NEW_CHAT_ID ? undefined : agentId,
							message: {
								text: getTextFromUserMessageOrThrow(messageToSend),
								images: images.length > 0 ? images : undefined,
								documents: documents.length > 0 ? documents : undefined,
								citation,
							},
							model: activeSelectedModelRef.current ?? undefined,
							mentions: mentions.length > 0 ? mentions : undefined,
							timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
							adminMode: adminModeAtSend || undefined,
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
					const files = attachmentsToFileUIParts(next);
					newAgent.sendMessage({ text: next.text, files: files.length > 0 ? files : undefined });
				} else {
					chatActivityStore.setRunning(agentId, false);
					if (agentId !== NEW_CHAT_ID && !isAbort) {
						queryClient.invalidateQueries({ queryKey: trpc.chat.get.queryKey({ chatId: agentId }) });
					}
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
	}, [chatId, disableNavigation, navigate, setChat, queryClient]);

	agentSendRefsStore.set(agentInstance, { adminModeRef, selectedModelRef, mentionsRef });

	const { status, error, clearError, sendMessage, setMessages, messages } = useChat({
		chat: agentInstance,
		experimental_throttle: 8,
	});
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	const stopAgentMutation = useMutation(trpc.chat.stop.mutationOptions());
	const cancelAgentMutation = useMutation(trpc.chat.cancel.mutationOptions());
	const switchMessageVersionMutation = useMutation(trpc.chat.switchMessageVersion.mutationOptions());
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

	// Carry admin mode across an admin conversation: enable it for chats whose first or
	// last user message was sent from admin mode, and disable it for normal chats. A
	// freshly created chat keeps its current mode so follow-ups stay in admin mode.
	const syncedAdminChatRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!chatId) {
			syncedAdminChatRef.current = undefined;
			return;
		}
		if (continuationChatIdRef.current === chatId) {
			continuationChatIdRef.current = undefined;
			syncedAdminChatRef.current = chatId;
			return;
		}
		if (chat.isLoading || messages.length === 0 || syncedAdminChatRef.current === chatId) {
			return;
		}
		syncedAdminChatRef.current = chatId;
		const userMessages = messages.filter((m) => m.role === 'user');
		const conversationIsAdmin = userMessages.at(0)?.source === 'admin' || userMessages.at(-1)?.source === 'admin';
		setAdminMode(conversationIsAdmin);
	}, [chatId, chat.isLoading, messages, setAdminMode]);

	const stopCurrentGeneration = useCallback(async () => {
		if (!chatId) {
			return;
		}

		agentInstance.stop(); // Stop the agent instance to instantly stop reading the stream
		await stopAgentMutation.mutateAsync({ chatId });
	}, [chatId, agentInstance, stopAgentMutation.mutateAsync]); // eslint-disable-line

	const cancelAgent = useCallback(async () => {
		if (!chatId) {
			return;
		}

		const currentMessages = messagesRef.current;
		const lastUserMessageIndex = getLastUserMessageIdx(currentMessages);
		const lastUserMessage = lastUserMessageIndex !== undefined ? currentMessages[lastUserMessageIndex] : undefined;
		const lastMessage = currentMessages.at(-1);
		const lastAssistantMessage = lastMessage?.role === 'assistant' ? lastMessage : undefined;

		if (lastAssistantMessage) {
			cancellingMessageIdStore.setCancelling(lastAssistantMessage.id);
		}
		agentInstance.stop();

		try {
			const result = await cancelAgentMutation.mutateAsync({ chatId });

			if (result.outcome === 'kept') {
				if (lastUserMessage) {
					editedMessageIdStore.setEditingId(lastUserMessage.id);
				}
				return;
			}

			if (lastUserMessageIndex !== undefined) {
				setMessages(currentMessages.slice(0, lastUserMessageIndex));
			}
			const restorePayload = lastUserMessage
				? {
						text: getMessageText(lastUserMessage),
						images: getMessageImages(lastUserMessage),
						documents: getMessageDocuments(lastUserMessage),
						citation: lastUserMessage.citation,
					}
				: undefined;

			if (result.chatDeleted) {
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				await navigate({ to: '/' });
				if (restorePayload) {
					chatInputRestoreStore.set(restorePayload);
				}
			} else if (restorePayload) {
				chatInputRestoreStore.set(restorePayload);
			}
		} finally {
			cancellingMessageIdStore.setCancelling(undefined);
		}
	}, [chatId, agentInstance, cancelAgentMutation.mutateAsync, setMessages, navigate, queryClient]); // eslint-disable-line

	const handleSendMessage = useCallback<UseChatHelpers<UIMessage>['sendMessage']>(
		async (...args) => {
			clearError();
			return sendMessage(...args);
		},
		[sendMessage, clearError],
	);

	const queueOrSendMessage = useCallback(
		async ({ text, images, documents, citation }: SendMessageArgs) => {
			const prompt = text.trim() || defaultAttachmentPrompt({ images, documents });
			if (!prompt) {
				return;
			}

			if (!isRunning) {
				agentCitationStore.set(agentInstance, citation);
				const files = attachmentsToFileUIParts({ images, documents });
				return handleSendMessage({ text: prompt, files: files.length > 0 ? files : undefined });
			}

			const mentions = [...mentionsRef.current];
			mentionsRef.current = [];

			messageQueueStore.enqueue(chatIdRef.current, {
				text: prompt,
				mentions,
				images,
				documents,
			});
		},
		[isRunning, handleSendMessage, agentInstance],
	);

	const submitQueuedMessageNow = useCallback(
		async (messageId: string) => {
			messageQueueStore.promoteToFront(chatIdRef.current, messageId);
			await stopCurrentGeneration();
			const next = messageQueueStore.dequeue(chatIdRef.current ?? NEW_CHAT_ID);
			if (next) {
				mentionsRef.current = next.mentions;
				const files = attachmentsToFileUIParts(next);
				await handleSendMessage({ text: next.text, files: files.length > 0 ? files : undefined });
			}
		},
		[stopCurrentGeneration, handleSendMessage],
	);

	const editMessage = useCallback(
		async ({
			messageId,
			text,
			images: newImages,
			documents: newDocuments,
		}: { messageId: string; text: string } & Pick<SendMessageArgs, 'images' | 'documents'>) => {
			if (isRunning) {
				return;
			}

			const currentMessages = messagesRef.current;
			const messageIndex = currentMessages.findIndex((message) => message.id === messageId);
			if (messageIndex === -1) {
				return;
			}

			const original = currentMessages[messageIndex];
			const originalImages = await resolveImagesFromMessage(original);
			const images = [...originalImages, ...(newImages ?? [])];
			const documents = [...getMessageDocuments(original), ...(newDocuments ?? [])];
			const prompt = text.trim() || defaultAttachmentPrompt({ images, documents });
			if (!prompt) {
				return;
			}

			agentCitationStore.set(agentInstance, original.citation);
			setMessages(currentMessages.slice(0, messageIndex));
			const files = attachmentsToFileUIParts({ images, documents });
			return handleSendMessage(
				{ text: prompt, files: files.length > 0 ? files : undefined },
				{ body: { messageToEditId: messageId } },
			);
		},
		[setMessages, isRunning, handleSendMessage, agentInstance],
	);

	const resendMessage = useCallback(
		async ({ messageId }: { messageId: string }) => {
			if (isRunning) {
				return;
			}

			const currentMessages = messagesRef.current;
			const messageIndex = currentMessages.findIndex((message) => message.id === messageId);
			if (messageIndex === -1) {
				return;
			}

			const original = currentMessages[messageIndex];
			const images = await resolveImagesFromMessage(original);
			const documents = getMessageDocuments(original);
			const text = getMessageText(original).trim() || defaultAttachmentPrompt({ images, documents });
			if (!text) {
				return;
			}

			agentCitationStore.set(agentInstance, original.citation);
			setMessages(currentMessages.slice(0, messageIndex));
			const files = attachmentsToFileUIParts({ images, documents });
			return handleSendMessage(
				{ text, files: files.length > 0 ? files : undefined },
				{ body: { messageToEditId: messageId } },
			);
		},
		[setMessages, isRunning, handleSendMessage, agentInstance],
	);

	const switchMessageVersion = useCallback(
		async ({ messageId }: { messageId: string }) => {
			const targetChatId = chatIdRef.current;
			if (!targetChatId || isRunning) {
				return;
			}

			await switchMessageVersionMutation.mutateAsync({ chatId: targetChatId, messageId });
			await queryClient.invalidateQueries({ queryKey: trpc.chat.get.queryKey({ chatId: targetChatId }) });
		},
		[isRunning, switchMessageVersionMutation.mutateAsync, queryClient], // eslint-disable-line
	);

	return useMemoObject({
		chatId,
		messages,
		setMessages,
		queueOrSendMessage,
		editMessage,
		resendMessage,
		switchMessageVersion,
		submitQueuedMessageNow,
		status,
		isRunning,
		isLoadingMessages: chat.isLoading,
		cancelAgent,
		error,
		clearError,
		selectedModel,
		setSelectedModel,
		setMentions,
		adminMode,
		setAdminMode,
	});
};

/** Sync the messages between the useChat hook and the query client. */
export const useSyncMessages = ({ agent }: { agent: AgentState }) => {
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

/** What to ask when someone attaches files without typing anything. */
function defaultAttachmentPrompt({
	images,
	documents,
}: {
	images?: { length: number };
	documents?: { length: number };
}): string {
	if (documents?.length) {
		return images?.length ? 'Have a look at these files' : 'Have a look at this data';
	}
	return images?.length ? 'Describe this image' : '';
}

/**
 * Both kinds of attachment ride along as file parts, so the optimistic message shows them
 * straight away. An image carries its bytes as a data URL; a document is already in
 * permanent storage and carries the path it was saved at.
 */
function attachmentsToFileUIParts({ images, documents }: Pick<SendMessageArgs, 'images' | 'documents'>): FileUIPart[] {
	return [
		...(images ?? []).map((image) => ({
			type: 'file' as const,
			mediaType: image.mediaType,
			url: `data:${image.mediaType};base64,${image.data}`,
		})),
		...(documents ?? []).map((document) => ({
			type: 'file' as const,
			mediaType: document.mediaType,
			filename: document.filename,
			url: document.path,
		})),
	];
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
