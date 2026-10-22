// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useAgent } from './use-agent';
import type { LlmSelectedModel } from '@nao/shared/types';

interface TestAgentConfig {
	onFinish: (event: { isAbort: boolean; isError: boolean; isDisconnect: boolean }) => void;
}

interface TestTransportConfig {
	prepareSendMessagesRequest: (request: {
		body: Record<string, unknown>;
		messages: Array<{ role: string }>;
	}) => unknown;
}

const mocks = vi.hoisted(() => {
	const invalidateQueries = vi.fn();
	return {
		agentConfig: null as TestAgentConfig | null,
		initialModel: { provider: 'nao', modelId: 'managed-model' } as LlmSelectedModel,
		invalidateQueries,
		navigate: vi.fn(),
		queryClient: { invalidateQueries },
		setChat: vi.fn(),
		transportConfig: null as TestTransportConfig | null,
	};
});

vi.mock('@ai-sdk/react', () => ({
	Chat: class {
		messages: unknown[] = [];
		sendMessage = vi.fn();
		stop = vi.fn();

		constructor(config: TestAgentConfig) {
			mocks.agentConfig = config;
		}
	},
	useChat: () => ({
		status: 'ready',
		error: undefined,
		clearError: vi.fn(),
		sendMessage: vi.fn(),
		setMessages: vi.fn(),
		messages: [],
	}),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ mutateAsync: vi.fn() }),
	useQuery: () => ({ data: mocks.initialModel }),
	useQueryClient: () => mocks.queryClient,
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
	useParams: () => ({}),
}));

vi.mock('ai', () => ({
	DefaultChatTransport: class {
		constructor(config: TestTransportConfig) {
			mocks.transportConfig = config;
		}
	},
}));

vi.mock('./use-chat-id', () => ({
	useChatId: () => undefined,
}));

vi.mock('./use-local-storage', () => {
	return {
		useLocalStorage: () => useState(mocks.initialModel),
	};
});

vi.mock('./use-prev', () => ({
	usePrevRef: () => ({ current: undefined }),
}));

vi.mock('./useMemoObject', () => ({
	useMemoObject: <T,>(value: T) => value,
}));

vi.mock('@/lib/active-project', () => ({
	getActiveProjectId: () => undefined,
	getProjectRequestHeaders: () => undefined,
}));

vi.mock('@/lib/ai', () => ({
	checkIsAgentRunning: () => false,
	extractDocumentPathsFromMessage: () => [],
	extractImagesFromMessage: () => [],
	getLastUserMessageIdx: () => undefined,
	getMessageDocuments: () => [],
	getMessageImages: () => [],
	getMessageText: () => '',
	getTextFromUserMessageOrThrow: () => 'question',
	NEW_CHAT_ID: 'new',
	parseBudgetError: () => false,
	parseManagedCreditsError: () => false,
	resolveImagesFromMessage: async () => [],
}));

vi.mock('@/lib/local-storage', () => ({
	createLocalStorage: () => ({}),
}));

vi.mock('@/main', () => ({
	trpc: {
		account: {
			getManagedCreditStatus: { queryKey: () => ['managed-status'] },
			getCreditSummary: { queryKey: () => ['credit-summary'] },
			listCreditLedger: { queryKey: () => ['credit-ledger'] },
			listManagedAiUsage: { queryKey: () => ['managed-usage'] },
		},
		chat: {
			stop: { mutationOptions: () => ({}) },
			cancel: { mutationOptions: () => ({}) },
			switchMessageVersion: { mutationOptions: () => ({}) },
			get: { queryKey: () => ['chat'] },
		},
		project: {
			getDefaultChatModel: { queryOptions: () => ({}) },
			listAvailableTranscribeModels: { queryKey: () => ['transcribe-models'] },
		},
	},
}));

vi.mock('@/queries/use-chat-query', () => ({
	useChatQuery: () => ({ isLoading: false, data: undefined }),
	useSetChat: () => mocks.setChat,
}));

vi.mock('@/services/agents', () => ({
	agentService: {
		getAgent: () => undefined,
		registerAgent: (_id: string, agent: unknown) => agent,
		moveAgent: vi.fn(),
		disposeAgent: vi.fn(),
	},
}));

vi.mock('@/stores/chat-activity', () => ({
	chatActivityStore: { setRunning: vi.fn(), setUnread: vi.fn() },
}));

vi.mock('@/stores/chat-cancelling-message', () => ({
	cancellingMessageIdStore: { setCancelling: vi.fn() },
}));

vi.mock('@/stores/chat-edited-message', () => ({
	editedMessageIdStore: { setEditingId: vi.fn() },
}));

vi.mock('@/stores/chat-input-restore', () => ({
	chatInputRestoreStore: { set: vi.fn() },
}));

vi.mock('@/stores/chat-message-queue', () => ({
	messageQueueStore: {
		clear: vi.fn(),
		dequeue: vi.fn(),
		enqueue: vi.fn(),
		moveQueue: vi.fn(),
		promoteToFront: vi.fn(),
	},
}));

describe('useAgent managed credit refresh', () => {
	beforeEach(() => {
		mocks.agentConfig = null;
		mocks.transportConfig = null;
		mocks.invalidateQueries.mockReset();
	});

	afterEach(cleanup);

	it('refreshes managed credit queries when the model selector changes during generation', () => {
		const { result } = renderHook(() => useAgent());
		mocks.transportConfig!.prepareSendMessagesRequest({
			body: {},
			messages: [{ role: 'user' }],
		});

		act(() => {
			result.current.setSelectedModel({ provider: 'openai', modelId: 'gpt-model' });
		});
		act(() => {
			mocks.agentConfig!.onFinish({ isAbort: false, isError: false, isDisconnect: false });
		});

		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-summary'] });
	});
});
