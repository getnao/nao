// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDropdownMenu } from '../helpers/dropdown-menu';
import type { ComponentProps } from 'react';
import { StoryPageHeader } from '@/components/story-page-header';
import { TooltipProvider } from '@/components/ui/tooltip';

const { favoritesQuery, resolvedStoryQuery, movableStory, submitStoryFeedback, archiveStory } = vi.hoisted(() => ({
	favoritesQuery: { data: undefined as { storyIds: string[] } | undefined },
	resolvedStoryQuery: {
		data: undefined as { isOwner: boolean; isArchived: boolean; projectId: string } | undefined,
	},
	movableStory: { value: undefined as { storyId: string; isOwner: boolean } | undefined },
	submitStoryFeedback: vi.fn(),
	archiveStory: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: ({ queryKey }: { queryKey?: string }) => {
		if (queryKey === 'story.resolve') {
			return resolvedStoryQuery;
		}
		if (queryKey === 'project.getCurrent') {
			return { data: { id: 'project-1' } };
		}
		return favoritesQuery;
	},
	useMutation: ({ procedure }: { procedure?: string }) => ({
		mutate: procedure ? (input: unknown) => archiveStory(procedure, input) : submitStoryFeedback,
		isPending: false,
	}),
	useQueryClient: () => ({}),
}));

vi.mock('@/components/editable-story-title', () => ({
	EditableStoryTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock('@/components/story-download', () => ({
	StoryDownloadMenu: () => null,
	canDownloadStory: () => true,
}));

vi.mock('@/hooks/use-movable-story', () => ({
	useMovableStory: () => movableStory.value,
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
		project: {
			getCurrent: {
				queryOptions: () => ({ queryKey: 'project.getCurrent' }),
			},
		},
		story: {
			getCertification: {
				queryOptions: () => ({}),
			},
			resolve: {
				queryOptions: () => ({ queryKey: 'story.resolve' }),
			},
			archiveShared: {
				mutationOptions: () => ({ procedure: 'archiveShared' }),
			},
			unarchiveShared: {
				mutationOptions: () => ({ procedure: 'unarchiveShared' }),
			},
		},
		feedback: {
			getStoryFeedback: {
				queryOptions: () => ({}),
			},
			submitStoryFeedback: {
				mutationOptions: () => ({}),
			},
		},
	},
}));

afterEach(cleanup);

describe('StoryPageHeader shared-story refresh control', () => {
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

describe('StoryPageHeader actions', () => {
	beforeEach(() => {
		favoritesQuery.data = undefined;
		resolvedStoryQuery.data = undefined;
		movableStory.value = undefined;
		archiveStory.mockClear();
	});

	it.each([
		[
			'archives an active story',
			{ isOwner: true, isArchived: false, projectId: 'project-1' },
			'Archive',
			'archiveShared',
		],
		[
			'unarchives an archived story',
			{ isOwner: true, isArchived: true, projectId: 'project-1' },
			'Unarchive',
			'unarchiveShared',
		],
	])('%s from the actions menu', (_, story, label, procedure) => {
		resolvedStoryQuery.data = story;
		renderPageHeader({ title: 'Revenue', storyId: 'story-1' });

		openDropdownMenu('More actions');
		fireEvent.click(screen.getByRole('menuitem', { name: label }));

		expect(archiveStory).toHaveBeenCalledWith(procedure, { storyId: 'story-1' });
	});

	it.each([
		['the user does not own the story', { isOwner: false, isArchived: true, projectId: 'project-1' }],
		['the story belongs to another project', { isOwner: true, isArchived: true, projectId: 'project-2' }],
	])('hides archiving when %s', (_, story) => {
		resolvedStoryQuery.data = story;
		renderPageHeader({ title: 'Revenue', storyId: 'story-1' });

		openDropdownMenu('More actions');

		expect(screen.queryByRole('menuitem', { name: /archive/i })).toBeNull();
	});

	it.each([
		['can move the story', { storyId: 'story-1', isOwner: true }, 1],
		['cannot move the story', undefined, 0],
	])('offers to move the story to a folder only when the user %s', (_, story, expectedCount) => {
		movableStory.value = story;
		renderPageHeader({ title: 'Revenue', storyId: 'story-1' });

		openDropdownMenu('More actions');

		expect(screen.queryAllByRole('menuitem', { name: 'Move to folder' })).toHaveLength(expectedCount);
	});

	it('renders a share button that calls onShare', () => {
		const onShare = vi.fn();
		renderPageHeader({ title: 'Revenue', onShare });

		fireEvent.click(screen.getByRole('button', { name: 'Share' }));

		expect(onShare).toHaveBeenCalledOnce();
	});

	it('only shows the header star once the story is favorited', () => {
		favoritesQuery.data = { storyIds: ['story-1'] };
		renderPageHeader({ title: 'Revenue', storyId: 'story-1' });

		expect(screen.getByRole('button', { name: 'Unfavorite' })).toBeDefined();
	});

	it('hides the header star when the story is not favorited', () => {
		renderPageHeader({ title: 'Revenue', storyId: 'story-1' });

		expect(screen.queryByRole('button', { name: 'Unfavorite' })).toBeNull();
	});

	it('submits story feedback with the chosen vote and optional message', () => {
		render(
			<TooltipProvider>
				<StoryPageHeader title='Revenue' storyId='story-1' />
			</TooltipProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Good story' }));
		fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Clear charts  ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(submitStoryFeedback).toHaveBeenCalledWith({
			storyId: 'story-1',
			vote: 'up',
			explanation: 'Clear charts',
		});
	});

	it('hides story feedback when there is no persisted story', () => {
		render(
			<TooltipProvider>
				<StoryPageHeader title='Revenue' />
			</TooltipProvider>,
		);

		expect(screen.queryByRole('button', { name: 'Good story' })).toBeNull();
	});
});

describe('StoryPageHeader on an older version', () => {
	afterEach(cleanup);

	it('tells the user when restoring the version failed', () => {
		render(
			<TooltipProvider>
				<StoryPageHeader
					title='Revenue'
					viewModeControls={{
						viewMode: 'preview',
						onViewModeChange: vi.fn(),
						saveError: 'Someone saved a newer version while you were editing.',
					}}
					versionControls={{
						currentVersion: 2,
						versions: [],
						isViewingLatest: false,
						onSelectVersion: vi.fn(),
						onRestore: vi.fn(),
					}}
				/>
			</TooltipProvider>,
		);

		expect(screen.getByRole('alert').textContent).toContain('Someone saved a newer version');
		expect(screen.getByRole('button', { name: /restore/i })).toBeTruthy();
	});
});

function renderHeader(canRefresh: boolean, onRefresh: () => void) {
	renderPageHeader({ title: 'Revenue', authorName: 'Test User', live: { isLive: true, canRefresh, onRefresh } });
}

function renderFailedStory(isRefreshing: boolean) {
	renderPageHeader({
		title: 'Revenue',
		live: {
			isLive: true,
			lastRefreshFailure: { errorMessage: 'No output generated.', failedAt: new Date() },
			isRefreshing,
		},
	});
}

function renderPageHeader(props: ComponentProps<typeof StoryPageHeader>) {
	render(
		<TooltipProvider>
			<StoryPageHeader {...props} />
		</TooltipProvider>,
	);
}
