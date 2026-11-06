// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryChatButton } from './story-chat-button';

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	requestAsk: vi.fn(),
	startChatWithStories: vi.fn(),
	resolvedStory: { storyId: 'story-1', chatId: 'origin-chat', slug: 'revenue', projectId: 'project-1' },
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey?: string }) => QUERY_RESULTS[options.queryKey ?? ''],
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/main', () => ({
	trpc: {
		project: { getCurrent: { queryOptions: () => ({ queryKey: 'project' }) } },
		story: {
			resolve: { queryOptions: () => ({ queryKey: 'resolve' }) },
			listQuickQuestions: { queryOptions: () => ({ queryKey: 'quick' }) },
			listMentioningChats: { queryOptions: () => ({ queryKey: 'mentioning' }) },
		},
	},
}));
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/use-project-switch', () => ({ useProjectSwitch: () => async () => false }));
vi.mock('@/hooks/use-start-chat-with-stories', () => ({ useStartChatWithStories: () => mocks.startChatWithStories }));
vi.mock('@/stores/ask-bar', () => ({ requestAsk: mocks.requestAsk }));

const QUERY_RESULTS: Record<string, unknown> = {
	resolve: { data: mocks.resolvedStory },
	project: { data: { id: 'project-1' } },
	quick: { data: [], isPending: false, isError: false },
	mentioning: { data: { chats: [] }, isPending: false, isError: false },
};

describe('StoryChatButton', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(cleanup);

	it('edits the story in its chat by default for its owner', async () => {
		render(<StoryChatButton storyId='story-1' isOwner canChat />);

		fireEvent.click(screen.getByRole('button', { name: 'Edit story' }));

		await vi.waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: '/$chatId',
				params: { chatId: 'origin-chat' },
				state: { openStorySlug: 'revenue' },
			}),
		);
	});

	it('asks about the story by default for anyone else', () => {
		render(<StoryChatButton storyId='story-1' isOwner={false} canChat />);

		fireEvent.click(screen.getByRole('button', { name: 'Ask story' }));

		expect(mocks.requestAsk).toHaveBeenCalledWith();
	});
});
