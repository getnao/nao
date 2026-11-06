// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgent } from './use-agent';

const mocks = vi.hoisted(() => {
	Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
	const trpcHandler: ProxyHandler<object> = {
		get: (_target, property) => {
			if (property === 'queryOptions') {
				return () => ({ queryKey: [], queryFn: async () => null, enabled: false });
			}
			if (property === 'mutationOptions') {
				return () => ({ mutationFn: async () => ({}) });
			}
			if (property === 'queryKey') {
				return () => [];
			}
			return new Proxy({}, trpcHandler);
		},
	};
	return {
		contextChatId: undefined as string | undefined,
		trpc: new Proxy({}, trpcHandler),
		navigate: vi.fn(),
		setChat: vi.fn(),
	};
});

vi.mock('./use-chat-id', () => ({ useChatId: () => mocks.contextChatId }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate, useParams: () => undefined }));
vi.mock('@/main', () => ({ trpc: mocks.trpc }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } } }) }));
vi.mock('@/queries/use-chat-query', () => ({
	useChatQuery: () => ({ data: undefined, isLoading: false }),
	useSetChat: () => mocks.setChat,
}));

const sentBodies: Array<{ adminMode?: boolean }> = [];

vi.stubGlobal(
	'fetch',
	vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
		sentBodies.push(JSON.parse(String(init?.body)));
		const chunks = [
			{ type: 'start', messageId: 'assistant-1' },
			{ type: 'data-newUserMessage', data: { newId: 'user-message-1' } },
			{ type: 'finish' },
		];
		const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
		return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
	}),
);

afterEach(() => {
	cleanup();
	sentBodies.length = 0;
	mocks.contextChatId = undefined;
});

describe('useAgent admin mode', () => {
	it('keeps admin mode when the first known message of the chat is the one being sent', async () => {
		mocks.contextChatId = 'chat-without-loaded-messages';
		const queryClient = new QueryClient();
		const { result } = renderHook(() => useAgent(), {
			wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
		});

		act(() => result.current.setAdminMode(true));
		await act(() => result.current.queueOrSendMessage({ text: 'How many chats this week?' }));

		await waitFor(() => expect(sentBodies).toHaveLength(1));
		expect(sentBodies[0].adminMode).toBe(true);
		expect(result.current.adminMode).toBe(true);
	});
});
