// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatStoryShortcut } from './chat-story-shortcut';
import { SidePanelProvider, useSidePanel } from '@/contexts/side-panel';
import { isMac } from '@/lib/platform';

vi.mock('@/components/side-panel/story-viewer', () => ({
	StoryViewer: () => null,
}));

describe('ChatStoryShortcut', () => {
	afterEach(cleanup);

	it('opens the latest story once while the panel is hidden', () => {
		const { open } = renderShortcut({ latestStorySlug: 'story-b' });

		pressStoryChatShortcut();

		expect(open).toHaveBeenCalledOnce();
		expect(open).toHaveBeenCalledWith(expect.anything(), 'story-b');
	});

	it('closes a visible panel without requiring a latest story', () => {
		let continueChange: () => void = () => {};
		const guard = vi.fn((continuation: () => void) => {
			continueChange = continuation;
		});
		const { close } = renderShortcut({ isVisible: true, guard });

		pressStoryChatShortcut();

		expect(guard).toHaveBeenCalledOnce();
		expect(close).not.toHaveBeenCalled();

		continueChange();
		expect(close).toHaveBeenCalledOnce();
	});

	it('stays inactive while hidden when no story exists', () => {
		const { open, close } = renderShortcut({});

		pressStoryChatShortcut();

		expect(open).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});
});

function renderShortcut({
	isVisible = false,
	latestStorySlug,
	guard,
}: {
	isVisible?: boolean;
	latestStorySlug?: string;
	guard?: (continueChange: () => void) => void;
}) {
	const open = vi.fn();
	const close = vi.fn();
	render(
		<SidePanelProvider
			isVisible={isVisible}
			currentStorySlug={isVisible ? 'story-a' : null}
			setCurrentStorySlug={vi.fn()}
			currentStoryTabIndex={0}
			setCurrentStoryTabIndex={vi.fn()}
			chatId='chat-1'
			open={open}
			close={close}
		>
			{guard && <RegisterGuard guard={guard} />}
			<ChatStoryShortcut chatId='chat-1' latestStorySlug={latestStorySlug} />
		</SidePanelProvider>,
	);
	return { open, close };
}

function RegisterGuard({ guard }: { guard: (continueChange: () => void) => void }) {
	const sidePanel = useSidePanel();
	useEffect(() => sidePanel.registerBeforeChange(guard), [guard, sidePanel]);
	return null;
}

function pressStoryChatShortcut() {
	fireEvent.keyDown(document, {
		key: 'B',
		shiftKey: true,
		metaKey: isMac,
		ctrlKey: !isMac,
	});
}
