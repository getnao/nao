// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDropdownMenu } from '../helpers/dropdown-menu';
import type { StoryVersionEntry } from '@/components/story-version-nav';
import { StoryVersionNav } from '@/components/story-version-nav';

const mocks = vi.hoisted(() => ({
	openChat: vi.fn(),
}));

vi.mock('@/hooks/use-open-story-chat', () => ({
	useOpenStoryChat: () => ({ openChat: mocks.openChat, isReady: true }),
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'viewer' } } }) }));

const VIEWER = { id: 'viewer', name: 'Test' };

const VERSIONS: StoryVersionEntry[] = [
	{
		createdAt: '2026-10-21T09:28:00.000Z',
		change: { author: VIEWER, via: 'original_chat', chat: { id: 'origin-chat', title: 'Creating a poem' } },
	},
	{
		createdAt: '2026-10-28T16:23:00.000Z',
		change: { author: VIEWER, via: 'quick_question', chat: { id: 'question-chat', title: 'Adding author name' } },
	},
	{
		createdAt: '2026-10-28T17:46:00.000Z',
		change: { author: VIEWER, via: 'editor', chat: null },
	},
];

describe('StoryVersionNav', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(cleanup);

	it('names each version after the chat it was made in, or how it was made', async () => {
		renderNav();

		openDropdownMenu('Version history');

		expect(await screen.findByText('Creating a poem')).toBeTruthy();
		expect(screen.getByText('Adding author name')).toBeTruthy();
		expect(screen.getByText('Manual edit')).toBeTruthy();
		expect(await findOpenChatButtons()).toHaveLength(2);
	});

	it('opens the chat of a version on its page, quick questions included, without selecting the version', async () => {
		const onSelectVersion = vi.fn();
		renderNav(onSelectVersion);

		openDropdownMenu('Version history');
		const [, originButton] = await findOpenChatButtons();
		clickWithPointer(originButton);

		expect(mocks.openChat).toHaveBeenCalledWith('origin-chat');
		expect(onSelectVersion).not.toHaveBeenCalled();

		openDropdownMenu('Version history');
		const [questionButton] = await findOpenChatButtons();
		clickWithPointer(questionButton);

		expect(mocks.openChat).toHaveBeenCalledWith('question-chat');
		expect(onSelectVersion).not.toHaveBeenCalled();
	});

	it('opens quick questions beside the story when it can, and other chats on their page', async () => {
		const onOpenQuickQuestion = vi.fn();
		renderNav(vi.fn(), onOpenQuickQuestion);

		openDropdownMenu('Version history');
		const [questionButton] = await findOpenChatButtons();
		clickWithPointer(questionButton);

		expect(onOpenQuickQuestion).toHaveBeenCalledWith('question-chat');
		expect(mocks.openChat).not.toHaveBeenCalled();

		openDropdownMenu('Version history');
		const [, originButton] = await findOpenChatButtons();
		clickWithPointer(originButton);

		expect(mocks.openChat).toHaveBeenCalledWith('origin-chat');
		expect(onOpenQuickQuestion).toHaveBeenCalledTimes(1);
	});

	it('keeps the original chat reachable when the story has a single version', async () => {
		renderNav(vi.fn(), undefined, VERSIONS.slice(0, 1));

		openDropdownMenu('Version history');
		const [originButton] = await findOpenChatButtons();
		clickWithPointer(originButton);

		expect(mocks.openChat).toHaveBeenCalledWith('origin-chat');
	});

	it('shows only the version date when a single version has no chat', () => {
		renderNav(vi.fn(), undefined, VERSIONS.slice(2));

		expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
	});
});

function renderNav(
	onSelectVersion = vi.fn(),
	onOpenQuickQuestion?: (chatId: string) => void,
	versions: StoryVersionEntry[] = VERSIONS,
) {
	render(
		<StoryVersionNav
			storyId='story-1'
			currentVersion={versions.length}
			versions={versions}
			onSelectVersion={onSelectVersion}
			onOpenQuickQuestion={onOpenQuickQuestion}
		/>,
	);
}

function findOpenChatButtons() {
	return screen.findAllByRole('button', { name: 'Open chat', hidden: true });
}

function clickWithPointer(element: HTMLElement) {
	fireEvent.pointerDown(element);
	fireEvent.pointerUp(element);
	fireEvent.click(element);
}
