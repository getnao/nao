// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryPageHeader } from './story-page-header';
import { TooltipProvider } from '@/components/ui/tooltip';

const { favoritesQuery } = vi.hoisted(() => ({
	favoritesQuery: { data: undefined as { storyIds: string[] } | undefined },
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => favoritesQuery,
}));

vi.mock('@/components/editable-story-title', () => ({
	EditableStoryTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock('@/components/story-download', () => ({
	StoryDownloadMenu: () => null,
	canDownloadStory: () => true,
}));

vi.mock('@/hooks/use-toggle-favorite', () => ({
	useToggleFavorite: () => ({ toggle: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-toggle-story-certification', () => ({
	useToggleStoryCertification: () => ({ toggle: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ isAdmin: false }),
}));

vi.mock('@/main', () => ({
	trpc: {
		favorite: {
			list: {
				queryOptions: () => ({}),
			},
		},
		story: {
			getCertification: {
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

describe('StoryPageHeader refresh failure banner', () => {
	afterEach(cleanup);

	it('shows the refresh failure', () => {
		renderFailedStory(false);

		expect(screen.getByRole('alert').textContent).toContain('Story refresh failed. No output generated.');
	});

	it('announces the retry while a refresh is running', () => {
		renderFailedStory(true);

		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByRole('status').textContent).toContain(
			'Retrying story refresh… Last attempt failed: No output generated.',
		);
	});
});

function renderFailedStory(isRefreshing: boolean) {
	return render(
		<TooltipProvider>
			<StoryPageHeader
				title='Revenue'
				live={{
					isLive: true,
					lastRefreshFailure: { errorMessage: 'No output generated.', failedAt: new Date() },
					isRefreshing,
				}}
			/>
		</TooltipProvider>,
	);
}

describe('StoryPageHeader actions', () => {
	beforeEach(() => {
		favoritesQuery.data = undefined;
	});
	afterEach(cleanup);

	it('renders a share button that calls onShare', () => {
		const onShare = vi.fn();
		render(
			<TooltipProvider>
				<StoryPageHeader title='Revenue' onShare={onShare} />
			</TooltipProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Share' }));

		expect(onShare).toHaveBeenCalledOnce();
	});

	it('only shows the header star once the story is favorited', () => {
		favoritesQuery.data = { storyIds: ['story-1'] };
		render(
			<TooltipProvider>
				<StoryPageHeader title='Revenue' storyId='story-1' />
			</TooltipProvider>,
		);

		expect(screen.getByRole('button', { name: 'Unfavorite' })).toBeDefined();
	});

	it('hides the header star when the story is not favorited', () => {
		render(
			<TooltipProvider>
				<StoryPageHeader title='Revenue' storyId='story-1' />
			</TooltipProvider>,
		);

		expect(screen.queryByRole('button', { name: 'Unfavorite' })).toBeNull();
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
