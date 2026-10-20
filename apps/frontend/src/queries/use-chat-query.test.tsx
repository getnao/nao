// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatQuery } from './use-chat-query';
import type { Chat } from './use-chat-query';

vi.mock('@/main', () => ({
	trpc: {
		chat: {
			get: {
				queryOptions: (input: { chatId: string }, options: object) => ({
					queryKey: chatQueryKey(input.chatId),
					queryFn: () => new Promise(() => {}),
					...options,
				}),
			},
		},
	},
}));

const CHAT_ID = 'chat-1';

describe('useChatQuery', () => {
	afterEach(cleanup);

	it('does not re-render a selecting component when only the streamed messages change', async () => {
		const queryClient = createQueryClientWithChat();
		const onRender = vi.fn();
		render(
			<QueryClientProvider client={queryClient}>
				<ChatTitle onRender={onRender} />
			</QueryClientProvider>,
		);
		expect(screen.getByText('Revenue')).toBeTruthy();
		const rendersAfterMount = onRender.mock.calls.length;

		await updateCache(() => appendStreamedMessage(queryClient));
		await updateCache(() => appendStreamedMessage(queryClient));
		expect(onRender).toHaveBeenCalledTimes(rendersAfterMount);

		await updateCache(() => renameChat(queryClient, 'Revenue by region'));
		expect(onRender).toHaveBeenCalledTimes(rendersAfterMount + 1);
		expect(screen.getByText('Revenue by region')).toBeTruthy();
	});

	it('re-renders on every streamed message without a select', async () => {
		const queryClient = createQueryClientWithChat();
		const onRender = vi.fn();
		render(
			<QueryClientProvider client={queryClient}>
				<FullChat onRender={onRender} />
			</QueryClientProvider>,
		);
		const rendersAfterMount = onRender.mock.calls.length;

		await updateCache(() => appendStreamedMessage(queryClient));
		await updateCache(() => appendStreamedMessage(queryClient));
		expect(onRender).toHaveBeenCalledTimes(rendersAfterMount + 2);
	});
});

function ChatTitle({ onRender }: { onRender: () => void }) {
	const { data: title } = useChatQuery({ chatId: CHAT_ID, select: selectTitle });
	onRender();
	return <span>{title}</span>;
}

function FullChat({ onRender }: { onRender: () => void }) {
	const { data: chat } = useChatQuery({ chatId: CHAT_ID });
	onRender();
	return <span>{chat?.messages.length}</span>;
}

function selectTitle(chat: Chat): string {
	return chat.title;
}

function createQueryClientWithChat(): QueryClient {
	const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	queryClient.setQueryData(chatQueryKey(CHAT_ID), { id: CHAT_ID, title: 'Revenue', messages: [] } as unknown as Chat);
	return queryClient;
}

function appendStreamedMessage(queryClient: QueryClient) {
	queryClient.setQueryData<Chat>(chatQueryKey(CHAT_ID), (chat) =>
		chat ? { ...chat, messages: [...chat.messages, { id: `message-${chat.messages.length}` } as never] } : chat,
	);
}

function renameChat(queryClient: QueryClient, title: string) {
	queryClient.setQueryData<Chat>(chatQueryKey(CHAT_ID), (chat) => (chat ? { ...chat, title } : chat));
}

function chatQueryKey(chatId: string) {
	return [['chat', 'get'], { input: { chatId }, type: 'query' }];
}

/** React Query notifies observers on a `setTimeout(0)` tick, so the update is flushed before asserting. */
async function updateCache(update: () => void) {
	await act(async () => {
		update();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
