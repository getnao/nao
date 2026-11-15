// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../helpers/deferred';
import type { AgentState } from '@/hooks/use-agent';
import { useAgent, useSyncMessages } from '@/hooks/use-agent';
import { agentService } from '@/services/agents';

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
		useChatQuery: vi.fn((): { data?: { messages: unknown[] }; isLoading?: boolean } => ({ data: undefined })),
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

	it('does not reconnect to a chat whose last saved message is an answer', async () => {
		openChat('answered-chat', [question, answer]);

		const { result } = renderAgent();

		await waitFor(() => expect(result.current.isLoadingMessages).toBe(false));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

function openChat(chatId: string, messages: unknown[]) {
	mocks.contextChatId = chatId;
	mocks.useChatQuery.mockReturnValue({ data: { messages }, isLoading: false });
}

function renderAgent(queryClient = new QueryClient()) {
	return renderHook(() => useAgent(), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
}

function toEventStreamResponse(chunks: unknown[]): Response {
	const events = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'];
	return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
}
