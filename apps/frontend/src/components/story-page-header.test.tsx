// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoryPageHeader } from './story-page-header';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: undefined }),
}));

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

describe('StoryPageHeader shared-story refresh control', () => {
	afterEach(cleanup);

	it('hides refresh when no refresh capability is provided', () => {
		renderHeader(false, vi.fn());

		expect(screen.queryByRole('button', { name: 'Refresh data' })).toBeNull();
	});

	it('shows refresh when refresh capability is provided', () => {
		const onRefresh = vi.fn();
		renderHeader(true, onRefresh);

		fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));

		expect(onRefresh).toHaveBeenCalledOnce();
	});
});

function renderHeader(canRefresh: boolean, onRefresh: () => void) {
	return render(
		<TooltipProvider>
			<StoryPageHeader
				title='Revenue'
				authorName='Test User'
				live={{
					isLive: true,
					canRefresh,
					onRefresh,
				}}
			/>
		</TooltipProvider>,
	);
}
