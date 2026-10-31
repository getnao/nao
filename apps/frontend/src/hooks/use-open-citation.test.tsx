// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CitationData } from '@nao/shared/types';

import { SidePanelProvider } from '@/contexts/side-panel';
import { SelectionProvider } from '@/contexts/text-selection';
import { useOpenCitation } from '@/hooks/use-open-citation';
import { useCodeRevealRequest } from '@/stores/code-reveal';

const mocks = vi.hoisted(() => ({
	questionStory: undefined as { storyId: string; chatId: string; slug: string } | undefined,
	openMentionedStory: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.questionStory }) }));
vi.mock('@/main', () => ({
	trpc: { chat: { get: { queryOptions: () => ({}) } }, story: { resolve: { queryOptions: () => ({}) } } },
}));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'question-chat' }));
vi.mock('@/hooks/use-mentioned-stories', () => ({ useOpenMentionedStory: () => mocks.openMentionedStory }));
vi.mock('@/components/side-panel/story-viewer', () => ({ StoryViewer: () => null }));

afterEach(() => {
	cleanup();
	mocks.questionStory = undefined;
	mocks.openMentionedStory.mockReset();
});

describe('useOpenCitation', () => {
	it('selects a passage of the page from a pill in the quick question beside it', () => {
		Element.prototype.scrollIntoView = vi.fn();
		const openCitation = renderPill(
			<>
				<p>Fresh juices, and smoothies.</p>
				<p>Our mission: handcrafted food.</p>
			</>,
		);

		act(() => openCitation({ start: 14, end: 40, text: 'and smoothies.\nOur mission' }));

		expect(window.getSelection()?.toString()).toBe('and smoothies.Our mission');
	});

	it('opens the story of an expanded quick question for a quote of it the chat does not show', () => {
		mocks.questionStory = { storyId: 'story-1', chatId: 'story-chat', slug: 'overview' };
		const openCitation = renderPill(<p>The answer about the mission.</p>, { sidePanelChatId: 'question-chat' });

		act(() => openCitation({ start: 0, end: 13, text: 'and smoothies' }));

		expect(mocks.openMentionedStory).toHaveBeenCalledWith(mocks.questionStory);
	});

	it('asks the code view of the story page for the lines a code pill cites', () => {
		mocks.questionStory = { storyId: 'story-1', chatId: 'story-chat', slug: 'overview' };
		const openCitation = renderPill(<p>The story.</p>);
		const request = renderHook(() => useCodeRevealRequest());
		const lines = { start: 3, end: 5 };

		act(() =>
			openCitation({
				start: 0,
				end: 0,
				text: 'const total = 1;',
				storySlug: 'overview',
				block: { kind: 'code', title: 'app.jsx', lines },
			}),
		);

		expect(mocks.openMentionedStory).not.toHaveBeenCalled();
		expect(request.result.current).toMatchObject({ storySlug: 'overview', filePath: 'app.jsx', lines });
	});
});

function renderPill(page: ReactNode, { sidePanelChatId }: { sidePanelChatId?: string } = {}) {
	let openCitation: (citation: CitationData) => void = () => {};
	const Pill = () => {
		openCitation = useOpenCitation();
		return null;
	};
	const content = (
		<SelectionProvider>
			{page}
			<SelectionProvider>
				<p>The answer about the mission.</p>
				<Pill />
			</SelectionProvider>
		</SelectionProvider>
	);
	render(
		sidePanelChatId ? (
			<SidePanelProvider
				isVisible={false}
				currentStorySlug={null}
				setCurrentStorySlug={() => {}}
				currentStoryTabIndex={0}
				setCurrentStoryTabIndex={() => {}}
				chatId={sidePanelChatId}
				open={() => {}}
				close={() => {}}
			>
				{content}
			</SidePanelProvider>
		) : (
			content
		),
	);
	return (citation: CitationData) => openCitation(citation);
}
