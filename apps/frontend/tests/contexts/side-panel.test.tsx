// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { SidePanelProvider, useSidePanel, useSidePanelActions } from '@/contexts/side-panel';

function GuardedStoryOpen({ guard, storySlug }: { guard: (continueChange: () => void) => void; storySlug: string }) {
	const sidePanel = useSidePanel();
	useEffect(() => sidePanel.registerBeforeChange(guard), [guard, sidePanel]);
	return <button onClick={() => sidePanel.open(<div />, storySlug)}>Open Story</button>;
}

const stableSetters = { setCurrentStorySlug: vi.fn(), setCurrentStoryTabIndex: vi.fn() };

function renderProvider(children: React.ReactNode, currentStorySlug: string | null) {
	return (
		<SidePanelProvider
			isVisible={currentStorySlug !== null}
			currentStorySlug={currentStorySlug}
			setCurrentStorySlug={stableSetters.setCurrentStorySlug}
			currentStoryTabIndex={0}
			setCurrentStoryTabIndex={stableSetters.setCurrentStoryTabIndex}
			chatId='chat-1'
			open={vi.fn()}
			close={vi.fn()}
		>
			{children}
		</SidePanelProvider>
	);
}

describe('SidePanelProvider', () => {
	afterEach(cleanup);

	it('keeps its actions stable while reading the latest panel state', () => {
		const seenActions: ReturnType<typeof useSidePanelActions>[] = [];
		function ActionsConsumer() {
			seenActions.push(useSidePanelActions());
			return null;
		}
		const consumer = <ActionsConsumer />;

		const { rerender } = render(renderProvider(consumer, null));
		rerender(renderProvider(consumer, 'story-a'));

		expect(seenActions).toHaveLength(1);
		expect(seenActions[0].getState()).toMatchObject({ isVisible: true, currentStorySlug: 'story-a' });
	});

	it.each([
		['switching Stories', 'story-b'],
		['reopening the same Story', 'story-a'],
	])('guards %s initiated outside the open Story', (_label, storySlug) => {
		let continueChange: () => void = () => {};
		const guard = vi.fn((continuation: () => void) => {
			continueChange = continuation;
		});
		const open = vi.fn();

		render(
			<SidePanelProvider
				isVisible
				currentStorySlug='story-a'
				setCurrentStorySlug={vi.fn()}
				currentStoryTabIndex={0}
				setCurrentStoryTabIndex={vi.fn()}
				chatId='chat-1'
				open={open}
				close={vi.fn()}
			>
				<GuardedStoryOpen guard={guard} storySlug={storySlug} />
			</SidePanelProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Open Story' }));
		expect(guard).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();

		continueChange();
		expect(open).toHaveBeenCalledWith(expect.anything(), storySlug);
	});
});
