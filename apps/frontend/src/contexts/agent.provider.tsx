import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';
import type { UIMessage } from '@nao/backend/chat';

import type { AgentHelpers, SendMessageArgs } from '@/hooks/use-agent';
import { useManagedWelcomeGrant } from '@/components/managed-welcome-grant-dialog';
import { useAgent, useSyncMessages } from '@/hooks/use-agent';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useStreamEndSound } from '@/hooks/use-stream-end-sound';
import { chatInputRestoreStore } from '@/stores/chat-input-restore';

export const AgentContext = createContext<AgentHelpers | null>(null);
const EMPTY_MESSAGES: UIMessage[] = [];
const emptyMessagesStore = createAgentMessagesStore(EMPTY_MESSAGES);
const AgentMessagesContext = createContext<AgentMessagesStore>(emptyMessagesStore);
const AgentMessagesValueContext = createContext<UIMessage[]>(EMPTY_MESSAGES);

export const useAgentContext = () => {
	const agent = useContext(AgentContext);
	if (!agent) {
		throw new Error('useAgentContext must be used within a AgentProvider');
	}
	return agent;
};

export const useOptionalAgentContext = () => useContext(AgentContext);

export const useAgentMessages = () => useContext(AgentMessagesValueContext);

export const useAgentMessagesGetter = () => useContext(AgentMessagesContext).getSnapshot;

export const useAgentMessagesSelector = <Selection,>(
	selector: (messages: UIMessage[]) => Selection,
	isEqual?: (left: Selection, right: Selection) => boolean,
) => {
	const store = useContext(AgentMessagesContext);
	return useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, store.getSnapshot, selector, isEqual);
};

export interface Props {
	children: React.ReactNode;
	disableNavigation?: boolean;
}

export const AgentProvider = ({ children, disableNavigation }: Props) => {
	const agent = useAgent({ disableNavigation });
	const navigate = useNavigate();
	const { confirmBeforeSend } = useManagedWelcomeGrant();
	const [messagesStore] = useState(() => createAgentMessagesStore(agent.messages));
	const confirmAgentSend = useCallback(
		() => confirmBeforeSend(agent.selectedModel?.provider),
		[confirmBeforeSend, agent.selectedModel?.provider],
	);
	const switchProject = useCallback(
		async (decision: Awaited<ReturnType<typeof confirmAgentSend>>) => {
			if (decision === 'switch-project') {
				await navigate({ to: '/' });
			}
		},
		[navigate],
	);
	const queueOrSendMessage = useCallback<AgentHelpers['queueOrSendMessage']>(
		async (args) => {
			const decision = await confirmAgentSend();
			if (decision === 'send') {
				return agent.queueOrSendMessage(args);
			}
			restoreChatInput(args);
			await switchProject(decision);
		},
		[agent, confirmAgentSend, switchProject],
	);
	const editMessage = useCallback<AgentHelpers['editMessage']>(
		async (args) => {
			const decision = await confirmAgentSend();
			if (decision === 'send') {
				return agent.editMessage(args);
			}
			restoreChatInput(args);
			await switchProject(decision);
		},
		[agent, confirmAgentSend, switchProject],
	);
	const resendMessage = useCallback<AgentHelpers['resendMessage']>(
		async (args) => {
			const decision = await confirmAgentSend();
			if (decision === 'send') {
				return agent.resendMessage(args);
			}
			await switchProject(decision);
		},
		[agent, confirmAgentSend, switchProject],
	);
	const value = useMemo<AgentHelpers>(
		() => ({
			chatId: agent.chatId,
			setMessages: agent.setMessages,
			queueOrSendMessage,
			editMessage,
			resendMessage,
			switchMessageVersion: agent.switchMessageVersion,
			submitQueuedMessageNow: agent.submitQueuedMessageNow,
			status: agent.status,
			isRunning: agent.isRunning,
			isLoadingMessages: agent.isLoadingMessages,
			cancelAgent: agent.cancelAgent,
			error: agent.error,
			clearError: agent.clearError,
			selectedModel: agent.selectedModel,
			setSelectedModel: agent.setSelectedModel,
			setMentions: agent.setMentions,
			adminMode: agent.adminMode,
			setAdminMode: agent.setAdminMode,
		}),
		[
			agent.chatId,
			agent.setMessages,
			queueOrSendMessage,
			editMessage,
			resendMessage,
			agent.switchMessageVersion,
			agent.submitQueuedMessageNow,
			agent.status,
			agent.isRunning,
			agent.isLoadingMessages,
			agent.cancelAgent,
			agent.error,
			agent.clearError,
			agent.selectedModel,
			agent.setSelectedModel,
			agent.setMentions,
			agent.adminMode,
			agent.setAdminMode,
		],
	);

	useLayoutEffect(() => {
		messagesStore.setMessages(agent.messages);
		messagesStore.notifySubscribers();
	}, [messagesStore, agent.messages]);

	useKeyboardShortcuts({
		'stop-generation': agent.isRunning ? agent.cancelAgent : undefined,
	});
	useSyncMessages({ agent });
	useStreamEndSound(agent.isRunning);

	return (
		<AgentContext.Provider value={value}>
			<AgentMessagesContext.Provider value={messagesStore}>
				<AgentMessagesValueContext.Provider value={agent.messages}>
					{children}
				</AgentMessagesValueContext.Provider>
			</AgentMessagesContext.Provider>
		</AgentContext.Provider>
	);
};

export const ReadonlyAgentMessagesProvider = ({
	messages,
	chatId,
	children,
}: {
	messages: UIMessage[];
	chatId?: string;
	children: React.ReactNode;
}) => {
	const [messagesStore] = useState(() => createAgentMessagesStore(messages));
	const value = useMemo<AgentHelpers>(
		() => ({
			chatId,
			setMessages: noop,
			queueOrSendMessage: noopPromise,
			editMessage: noopPromise,
			resendMessage: noopPromise,
			switchMessageVersion: noopPromise,
			submitQueuedMessageNow: noopPromise,
			status: 'ready',
			isRunning: false,
			isLoadingMessages: false,
			cancelAgent: noopPromise,
			error: undefined,
			clearError: noop,
			selectedModel: null,
			setSelectedModel: noop,
			setMentions: noop,
			adminMode: false,
			setAdminMode: noop,
			isReadonly: true,
		}),
		[chatId],
	);

	useLayoutEffect(() => {
		messagesStore.setMessages(messages);
		messagesStore.notifySubscribers();
	}, [messagesStore, messages]);

	return (
		<AgentContext.Provider value={value}>
			<AgentMessagesContext.Provider value={messagesStore}>
				<AgentMessagesValueContext.Provider value={messages}>{children}</AgentMessagesValueContext.Provider>
			</AgentMessagesContext.Provider>
		</AgentContext.Provider>
	);
};

interface AgentMessagesStore {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => UIMessage[];
	setMessages: (messages: UIMessage[]) => void;
	notifySubscribers: () => void;
}

function createAgentMessagesStore(initialMessages: UIMessage[]): AgentMessagesStore {
	let messages = initialMessages;
	const listeners = new Set<() => void>();

	return {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => messages,
		setMessages: (nextMessages) => {
			if (messages === nextMessages) {
				return;
			}
			messages = nextMessages;
		},
		notifySubscribers: () => {
			listeners.forEach((listener) => listener());
		},
	};
}

const noop = () => {};
const noopPromise = async () => {};

function restoreChatInput(args: SendMessageArgs) {
	chatInputRestoreStore.set({
		text: args.text,
		images: args.images?.map((image) => ({ url: image.data, mediaType: image.mediaType })) ?? [],
		documents: args.documents ?? [],
		citation: args.citation,
	});
}
