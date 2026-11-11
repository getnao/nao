// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgent } from './use-agent';
import { NEW_CHAT_ID } from '@/lib/ai';
import { agentService } from '@/services/agents';

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
const openStreams: ReadableStreamDefaultController<string>[] = [];
let keepStreamOpen = false;

vi.stubGlobal(
	'fetch',
	vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
		sentBodies.push(JSON.parse(String(init?.body)));
		const chunks = [
			{ type: 'start', messageId: 'assistant-1' },
			{ type: 'data-newUserMessage', data: { newId: 'user-message-1' } },
		];
		const stream = new ReadableStream<string>({
			start(controller) {
				chunks.forEach((chunk) => controller.enqueue(toServerSentEvent(chunk)));
				if (keepStreamOpen) {
					openStreams.push(controller);
					return;
				}
				closeStream(controller);
			},
		});
		return new Response(stream.pipeThrough(new TextEncoderStream()), {
			headers: { 'content-type': 'text/event-stream' },
		});
	}),
);

afterEach(() => {
	openStreams.splice(0).forEach(closeStream);
	cleanup();
	sentBodies.length = 0;
	keepStreamOpen = false;
	mocks.contextChatId = undefined;
	agentService.disposeAgent(NEW_CHAT_ID);
});

describe('useAgent admin mode', () => {
	it('keeps admin mode when the first known message of the chat is the one being sent', async () => {
		mocks.contextChatId = 'chat-without-loaded-messages';
		const { result } = renderAgent();

		act(() => result.current.setAdminMode(true));
		await act(() => result.current.queueOrSendMessage({ text: 'How many chats this week?' }));

		await waitFor(() => expect(sentBodies).toHaveLength(1));
		expect(sentBodies[0].adminMode).toBe(true);
		expect(result.current.adminMode).toBe(true);
	});

	it('restores admin mode when reopening a chat whose admin reply is still running', async () => {
		mocks.contextChatId = 'running-admin-chat';
		keepStreamOpen = true;
		const firstMount = renderAgent();

		act(() => firstMount.result.current.setAdminMode(true));
		act(() => {
			void firstMount.result.current.queueOrSendMessage({ text: 'How many chats this week?' });
		});
		await waitFor(() => expect(firstMount.result.current.messages.at(0)?.source).toBe('admin'));
		firstMount.unmount();

		const { result } = renderAgent();

		expect(result.current.isRunning).toBe(true);
		await waitFor(() => expect(result.current.adminMode).toBe(true));
	});
});

function renderAgent() {
	const queryClient = new QueryClient();
	return renderHook(() => useAgent(), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
}

function toServerSentEvent(chunk: unknown): string {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

function closeStream(controller: ReadableStreamDefaultController<string>) {
	controller.enqueue(toServerSentEvent({ type: 'finish' }));
	controller.enqueue('data: [DONE]\n\n');
	controller.close();
}
