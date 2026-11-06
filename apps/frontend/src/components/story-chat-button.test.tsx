// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryChatButton } from './story-chat-button';

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	requestAsk: vi.fn(),
	startChatWithStories: vi.fn(),
	resolvedStory: {
		storyId: 'story-1',
		chatId: 'origin-chat' as string | null,
		slug: 'revenue',
		projectId: 'project-1',
	},
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

const NOW = new Date().toISOString();

const QUERY_RESULTS: Record<string, unknown> = {
	resolve: { data: mocks.resolvedStory },
	project: { data: { id: 'project-1' } },
	quick: {
		data: [{ chatId: 'question-chat', title: 'Why did revenue drop?', updatedAt: NOW }],
		isPending: false,
		isError: false,
	},
	mentioning: {
		data: {
			chats: [
				{ chatId: 'origin-chat', title: 'Revenue analysis', updatedAt: NOW, isOrigin: true },
				{ chatId: 'other-chat', title: 'Churn deep dive', updatedAt: NOW, isOrigin: false },
			],
		},
		isPending: false,
		isError: false,
	},
};

describe('StoryChatButton', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(cleanup);

	it('edits the story from the ask bar by default for its owner', () => {
		render(<StoryChatButton storyId='story-1' isOwner canChat />);

		fireEvent.click(screen.getByRole('button', { name: 'Edit story' }));

		expect(mocks.requestAsk).toHaveBeenCalledWith();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it('leaves the original chat out of the menu, the version history opens it', async () => {
		render(<StoryChatButton storyId='story-1' isOwner canChat />);

		openMenu();

		await screen.findByRole('menuitem', { name: /^Mention story/ });
		expect(screen.queryByRole('menuitem', { name: /^Open original chat/ })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: /^Open in a chat/ })).toBeNull();
	});

	it('opens a standalone story in a new chat from the menu', async () => {
		const onOpenInChat = vi.fn();
		mocks.resolvedStory.chatId = null;
		render(<StoryChatButton storyId='story-1' isOwner canChat onOpenInChat={onOpenInChat} />);

		openMenu();
		fireEvent.click(await screen.findByRole('menuitem', { name: /^Open in a chat/ }));

		expect(onOpenInChat).toHaveBeenCalled();
		mocks.resolvedStory.chatId = 'origin-chat';
	});

	it('keeps opening a standalone story in a chat to its owner', async () => {
		mocks.resolvedStory.chatId = null;
		render(<StoryChatButton storyId='story-1' isOwner={false} canChat onOpenInChat={vi.fn()} />);

		openMenu();

		await screen.findByRole('menuitem', { name: /^Mention story/ });
		expect(screen.queryByRole('menuitem', { name: /^Open in a chat/ })).toBeNull();
		mocks.resolvedStory.chatId = 'origin-chat';
	});

	it('asks about the story by default for anyone else', () => {
		render(<StoryChatButton storyId='story-1' isOwner={false} canChat />);

		fireEvent.click(screen.getByRole('button', { name: 'Ask story' }));

		expect(mocks.requestAsk).toHaveBeenCalledWith();
	});
});

describe('StoryChatButton chats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(cleanup);

	it('lists the quick questions and the mentions, without the original chat', async () => {
		render(<StoryChatButton storyId='story-1' isOwner canChat />);

		openMenu();

		expect(await screen.findByText('Quick questions')).toBeTruthy();
		expect(screen.getByText('Mentions')).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: /^Revenue analysis/ })).toBeNull();
	});

	it('opens a quick question in the ask bar and a mention on its page', async () => {
		render(<StoryChatButton storyId='story-1' isOwner canChat />);

		openMenu();
		fireEvent.click(await screen.findByRole('menuitem', { name: /^Why did revenue drop/ }));
		expect(mocks.requestAsk).toHaveBeenCalledWith({ chatId: 'question-chat' });

		openMenu();
		fireEvent.click(await screen.findByRole('menuitem', { name: /^Churn deep dive/ }));
		await vi.waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({ to: '/$chatId', params: { chatId: 'other-chat' } }),
		);
	});
});

function openMenu() {
	fireEvent.pointerDown(screen.getByRole('button', { name: 'More ways to talk to this story' }), {
		button: 0,
		ctrlKey: false,
	});
}
