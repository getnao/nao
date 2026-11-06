// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRefreshStoryChat } from './use-refresh-story-chat';
import type { ReactNode } from 'react';
import type { UIToolPart } from '@nao/backend/chat';

const STORY_CHAT_KEY = [['story', 'listVersions'], { input: { chatId: 'story-chat', storySlug: 'revenue' } }];
const OTHER_CHAT_KEY = [['chat', 'get'], { input: { chatId: 'other-chat' } }];

describe('useRefreshStoryChat', () => {
	afterEach(() => {
		cleanup();
	});

	it('refreshes the queries of the story chat once an edit from another chat lands', () => {
		const queryClient = createQueryClient();
		const { rerender } = renderHook(({ part }) => useRefreshStoryChat(part), {
			initialProps: { part: storyPart('input-available') },
			wrapper: withQueryClient(queryClient),
		});

		rerender({ part: storyPart('output-available', 'story-chat') });

		expect(queryClient.getQueryState(STORY_CHAT_KEY)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(OTHER_CHAT_KEY)?.isInvalidated).toBe(false);
	});

	it('leaves the cache alone for an edit already done when the card mounts', () => {
		const queryClient = createQueryClient();
		renderHook(() => useRefreshStoryChat(storyPart('output-available', 'story-chat')), {
			wrapper: withQueryClient(queryClient),
		});

		expect(queryClient.getQueryState(STORY_CHAT_KEY)?.isInvalidated).toBe(false);
	});
});

function createQueryClient() {
	const queryClient = new QueryClient();
	queryClient.setQueryData(STORY_CHAT_KEY, { versions: [] });
	queryClient.setQueryData(OTHER_CHAT_KEY, { messages: [] });
	return queryClient;
}

function withQueryClient(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

function storyPart(state: 'input-available' | 'output-available', storyChatId?: string): UIToolPart<'story'> {
	return {
		type: 'tool-story',
		toolCallId: 'story-call',
		state,
		input: { action: 'replace', id: 'story-id', code: '# Revenue' },
		output:
			state === 'output-available'
				? {
						_version: '1',
						success: true,
						id: 'revenue',
						version: 2,
						code: '# Revenue',
						title: 'Revenue',
						story_chat_id: storyChatId,
					}
				: undefined,
	} as UIToolPart<'story'>;
}
