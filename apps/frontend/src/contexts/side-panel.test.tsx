// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { SidePanelProvider, useSidePanel } from './side-panel';

function GuardedStoryOpen({ guard, storySlug }: { guard: (continueChange: () => void) => void; storySlug: string }) {
	const sidePanel = useSidePanel();
	useEffect(() => sidePanel.registerBeforeChange(guard), [guard, sidePanel]);
	return <button onClick={() => sidePanel.open(<div />, storySlug)}>Open Story</button>;
}

describe('SidePanelProvider', () => {
	afterEach(cleanup);

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
