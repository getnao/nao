// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoryPageHeader } from './story-page-header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isMac } from '@/lib/platform';

vi.mock('@/components/editable-story-title', () => ({
	EditableStoryTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock('@/components/story-download', () => ({
	StoryDownload: () => null,
}));

vi.mock('@/hooks/use-toggle-favorite', () => ({
	useToggleFavorite: () => ({ toggle: vi.fn(), isPending: false }),
}));

vi.mock('@/main', () => ({
	trpc: {
		favorite: {
			list: {
				queryOptions: () => ({}),
			},
		},
	},
}));

describe('StoryPageHeader shortcut', () => {
	afterEach(cleanup);

	it('opens chat while the action is available', () => {
		const onOpenChat = vi.fn();
		renderHeader({ onOpenChat });

		pressStoryChatShortcut();

		expect(onOpenChat).toHaveBeenCalledOnce();
	});

	it('does not open chat while the action is loading', () => {
		const onOpenChat = vi.fn();
		renderHeader({ onOpenChat, isOpeningChat: true });

		pressStoryChatShortcut();

		expect(onOpenChat).not.toHaveBeenCalled();
	});
});

function renderHeader(props: { onOpenChat: () => void; isOpeningChat?: boolean }) {
	return render(
		<TooltipProvider>
			<StoryPageHeader title='Revenue' {...props} />
		</TooltipProvider>,
	);
}

function pressStoryChatShortcut() {
	fireEvent.keyDown(document, {
		key: 'B',
		shiftKey: true,
		metaKey: isMac,
		ctrlKey: !isMac,
	});
}
