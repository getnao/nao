// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../helpers/deferred';
import type { AgentState } from '@/hooks/use-agent';
import { useAgent, useSyncMessages } from '@/hooks/use-agent';
import { agentService } from '@/services/agents';
import { chatActivityStore } from '@/stores/chat-activity';

const mocks = vi.hoisted(() => {
	Object.defineProperty(URL, 'createObjectURL', {
		configurable: true,
		value: vi.fn(() => 'blob:test'),
	});
	const trpcHandler: ProxyHandler<object> = {
		get: (_target, property) => {
			if (property === 'queryOptions') {
				return () => ({ queryKey: [], queryFn: async () => null, enabled: false });
			}
			if (property === 'mutationOptions') {
				return () => ({ mutationFn: async () => ({}) });
			}
			if (property === 'queryKey') {
				return (input: unknown) => ['trpc-query', input];
			}
			return new Proxy({}, trpcHandler);
		},
	};

	return {
		contextChatId: undefined as string | undefined,
		setChat: vi.fn(),
		trpc: new Proxy({}, trpcHandler),
		useChatQuery: vi.fn((_query: { chatId?: string }): { data?: { messages: unknown[] }; isLoading?: boolean } => ({
			data: undefined,
		})),
	};
});

vi.mock('@/hooks/use-chat-id', () => ({
	useChatId: () => mocks.contextChatId,
}));

vi.mock('@/queries/use-chat-query', () => ({
	useChatQuery: mocks.useChatQuery,
	useSetChat: () => mocks.setChat,
}));

vi.mock('@/main', () => ({ trpc: mocks.trpc }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), useParams: () => undefined }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } } }) }));

afterEach(() => {
	cleanup();
	mocks.contextChatId = undefined;
	vi.clearAllMocks();
});

describe('useSyncMessages', () => {
	it('uses the agent chat ID for onboarding message snapshots', () => {
		const agent = {
			chatId: 'onboarding-chat',
			mode: 'onboarding',
			messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
			isRunning: true,
			setMessages: vi.fn(),
		} as unknown as AgentState;

		renderHook(() => useSyncMessages({ agent }));

		expect(mocks.useChatQuery).toHaveBeenCalledWith({ chatId: 'onboarding-chat' });
		expect(mocks.setChat).toHaveBeenCalledWith({ chatId: 'onboarding-chat' }, expect.any(Function));
	});

	it('keeps using the route chat ID for regular chat navigation', () => {
		mocks.contextChatId = 'route-chat';
		const agent = {
			chatId: 'previous-chat',
			mode: 'default',
			messages: [],
			isRunning: false,
			setMessages: vi.fn(),
		} as unknown as AgentState;

		renderHook(() => useSyncMessages({ agent }));

		expect(mocks.useChatQuery).toHaveBeenCalledWith({ chatId: 'route-chat' });
	});
});

describe('useAgent stream resume', () => {
	const question = { id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'How did revenue do?' }] };
	const answer = { id: 'assistant-message', role: 'assistant', parts: [{ type: 'text', text: 'It grew.' }] };
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		if (mocks.contextChatId) {
			agentService.disposeAgent(mocks.contextChatId);
		}
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	});

	it('replays the answer still running on the server when the chat is reopened', async () => {
		openChat('running-chat', [question]);
		fetchMock.mockResolvedValue(
			toEventStreamResponse([
				{ type: 'start', messageId: 'assistant-message' },
				{ type: 'text-start', id: 'text-1' },
				{ type: 'text-delta', id: 'text-1', delta: 'Revenue grew 12%.' },
				{ type: 'text-end', id: 'text-1' },
				{ type: 'finish' },
			]),
		);

		const { result } = renderAgent();

		await waitFor(() =>
			expect(result.current.messages.at(-1)?.parts).toContainEqual(
				expect.objectContaining({ text: 'Revenue grew 12%.' }),
			),
		);
		expect(result.current.messages.map((message) => message.id)).toEqual(['user-message', 'assistant-message']);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/agent/running-chat/stream',
			expect.objectContaining({ method: 'GET' }),
		);
	});

	it('catches up from the reconnection until the server answers', async () => {
		openChat('slow-chat', [question]);
		const serverAnswer = deferred<Response>();
		fetchMock.mockReturnValue(serverAnswer.promise);

		const { result } = renderAgent();

		await waitFor(() => expect(result.current.isCatchingUp).toBe(true));
		serverAnswer.resolve(
			toEventStreamResponse([{ type: 'start', messageId: 'assistant-message' }, { type: 'finish' }]),
		);
		await waitFor(() => expect(result.current.isCatchingUp).toBe(false));
		expect(result.current.messages.at(-1)?.id).toBe('assistant-message');
	});

	it('fetches the chat again when its answer completed before the reconnection', async () => {
		openChat('finished-chat', [question]);
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

		renderAgent(queryClient);

		await waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['trpc-query', { chatId: 'finished-chat' }] }),
		);
	});

	it('reconnects a second time when the run was not announced yet', async () => {
		openChat('starting-chat', [question]);
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
		fetchMock.mockResolvedValueOnce(
			toEventStreamResponse([{ type: 'start', messageId: 'assistant-message' }, { type: 'finish' }]),
		);
		const queryClient = new QueryClient();
		queryClient.setQueryData(['trpc-query', { chatId: 'starting-chat' }], { messages: [question] });

		const { result } = renderAgent(queryClient);

		await waitFor(() => expect(result.current.messages.at(-1)?.id).toBe('assistant-message'), { timeout: 3_000 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not resume a chat with the messages of the chat it navigated from', async () => {
		mocks.useChatQuery.mockImplementation(({ chatId }) => ({
			data: { messages: chatId === 'next-chat' ? [question, answer] : [question] },
			isLoading: false,
		}));
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		mocks.contextChatId = 'previous-chat';
		const { rerender } = renderAgent();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		agentService.disposeAgent('previous-chat');
		fetchMock.mockClear();

		mocks.contextChatId = 'next-chat';
		rerender();

		await waitFor(() => expect(mocks.useChatQuery).toHaveBeenLastCalledWith({ chatId: 'next-chat' }));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not reconnect to a chat whose last saved message is an answer', async () => {
		openChat('answered-chat', [question, answer]);

		const { result } = renderAgent();

		await waitFor(() => expect(result.current.isLoadingMessages).toBe(false));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('useAgent chat activity', () => {
	const answered = [
		{ id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'How did revenue do?' }] },
		{ id: 'assistant-message', role: 'assistant', parts: [{ type: 'text', text: 'It grew.' }] },
	];

	afterEach(() => {
		['running-chat', 'idle-chat'].forEach((chatId) => {
			agentService.getAgent(chatId)?.stop();
			agentService.disposeAgent(chatId);
			chatActivityStore.setRunning(chatId, false);
			chatActivityStore.setUnread(chatId, false);
		});
		vi.unstubAllGlobals();
	});

	it('keeps each chat running state its own when navigating between a running and an idle chat', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {})),
		);
		openChat('running-chat', answered);
		const { result, rerender } = renderAgent();
		void agentService.getAgent('running-chat')!.sendMessage({ text: 'And costs?' });
		await waitFor(() => expect(result.current.isRunning).toBe(true));

		mocks.contextChatId = 'idle-chat';
		rerender();
		await waitFor(() => expect(result.current.isRunning).toBe(false));
		expect(chatActivityStore.getActivity('running-chat').running).toBe(true);

		mocks.contextChatId = 'running-chat';
		rerender();
		await waitFor(() => expect(result.current.isRunning).toBe(true));
		expect(chatActivityStore.getActivity('idle-chat').running).toBe(false);
	});

	it('keeps the answer of a panel running when its chat opens in full', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {})),
		);
		openChat('running-chat', answered);
		const panel = renderAgent(new QueryClient(), { disableNavigation: true });
		void panel.result.current.queueOrSendMessage({ text: 'And costs?' });
		await waitFor(() => expect(panel.result.current.isRunning).toBe(true));
		panel.unmount();

		const { result } = renderAgent();

		expect(result.current.isRunning).toBe(true);
	});
});

function openChat(chatId: string, messages: unknown[]) {
	mocks.contextChatId = chatId;
	mocks.useChatQuery.mockReturnValue({ data: { messages }, isLoading: false });
}

function renderAgent(queryClient = new QueryClient(), options?: Parameters<typeof useAgent>[0]) {
	return renderHook(() => useAgent(options), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
}

function toEventStreamResponse(chunks: unknown[]): Response {
	const events = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'];
	return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
}
