// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryHeader } from './story-header';
import type { StoryHeaderProps } from './story-header';
import { TooltipProvider } from '@/components/ui/tooltip';

const { favoritesQuery } = vi.hoisted(() => ({
	favoritesQuery: { data: undefined as { storyIds: string[] } | undefined },
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey?: string[] }) => {
		return options.queryKey?.[0] === 'favorites' ? favoritesQuery : { data: undefined };
	},
}));

vi.mock('@/components/editable-story-title', () => ({
	EditableStoryTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock('@/components/story-download', () => ({
	StoryDownloadMenu: () => <div role='menuitem'>Download</div>,
	canDownloadStory: () => true,
}));

vi.mock('@/components/story-page-header', () => ({
	LiveStoryTimestamp: () => null,
	StoryRefreshFailureBanner: () => null,
}));

vi.mock('@/hooks/use-is-mobile', () => ({
	useIsMobile: () => false,
}));

vi.mock('@/hooks/use-toggle-favorite', () => ({
	useToggleFavorite: () => ({ toggle: vi.fn(), isPending: false }),
}));

vi.mock('@/main', () => ({
	trpc: {
		favorite: {
			list: {
				queryOptions: () => ({ queryKey: ['favorites'] }),
			},
		},
		story: {
			listStories: {
				queryOptions: () => ({ queryKey: ['stories'] }),
			},
		},
	},
}));

describe('StoryHeader actions', () => {
	beforeEach(() => {
		favoritesQuery.data = undefined;
	});
	afterEach(cleanup);

	it('renders a share button that calls onShare', () => {
		const onShare = vi.fn();
		renderHeader({ onShare });

		fireEvent.click(screen.getByRole('button', { name: 'Share' }));

		expect(onShare).toHaveBeenCalledOnce();
	});

	it('switches the share icon once the story is shared', () => {
		const { container } = renderHeader({ isShared: true });

		expect(container.querySelector('.lucide-globe')).not.toBeNull();
		expect(container.querySelector('.lucide-upload')).toBeNull();
	});

	it('disables share while the agent is running', () => {
		renderHeader({ isAgentRunning: true });

		expect(screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled')).toBe(true);
	});

	it('hides share in readonly mode', () => {
		renderHeader({ isReadonlyMode: true });

		expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
	});

	it('lists download, favorite, analytics and expand in the actions menu', () => {
		renderHeader({ storyId: 'story-1' });

		openActionsMenu();

		expect(screen.getByRole('menuitem', { name: 'Download' })).toBeDefined();
		expect(screen.getByRole('menuitem', { name: 'Favorite' })).toBeDefined();
		expect(screen.getByRole('menuitem', { name: 'Analytics' })).toBeDefined();
		expect(screen.getByRole('menuitem', { name: 'Expand' })).toBeDefined();
	});

	it('only shows the header star once the story is favorited', () => {
		favoritesQuery.data = { storyIds: ['story-1'] };
		renderHeader({ storyId: 'story-1' });

		expect(screen.getByRole('button', { name: 'Unfavorite' })).toBeDefined();

		openActionsMenu();

		expect(screen.getByRole('menuitem', { name: 'Unfavorite' })).toBeDefined();
	});

	it('hides the header star when the story is not favorited', () => {
		renderHeader({ storyId: 'story-1' });

		expect(screen.queryByRole('button', { name: 'Unfavorite' })).toBeNull();
	});
});

describe('StoryHeader editing subheader', () => {
	afterEach(cleanup);

	it('shows save controls whenever visual Edit mode is active', () => {
		renderHeader({ viewMode: 'edit' });

		expect(screen.getByText('Editing')).toBeDefined();
		expect(screen.getByRole('button', { name: /save/i })).toBeDefined();
	});

	it('hides save controls in Preview mode', () => {
		renderHeader({ viewMode: 'preview' });

		expect(screen.queryByText('Editing')).toBeNull();
		expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
	});

	it('keeps save controls for dirty code', () => {
		renderHeader({ viewMode: 'code', isCodeDirty: true });

		expect(screen.getByText('Editing code')).toBeDefined();
		expect(screen.getByRole('button', { name: /save/i })).toBeDefined();
	});
});

function openActionsMenu() {
	fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }), { button: 0, ctrlKey: false });
}

function renderHeader(overrides: Partial<StoryHeaderProps>) {
	const props: StoryHeaderProps = {
		title: 'Revenue',
		chatId: 'chat-1',
		storySlug: 'revenue',
		allStories: [],
		onSwitchStory: vi.fn(),
		viewMode: 'preview',
		onViewModeChange: vi.fn(),
		currentVersion: 1,
		totalVersions: 1,
		onPreviousVersion: vi.fn(),
		onNextVersion: vi.fn(),
		isViewingLatest: true,
		onRestore: vi.fn(),
		onSave: vi.fn(),
		onCancel: vi.fn(),
		onShare: vi.fn(),
		onOpenAnalytics: vi.fn(),
		onEnlarge: vi.fn(),
		isShared: false,
		isAgentRunning: false,
		isStoryUpdating: false,
		isReadonlyMode: false,
		isLive: false,
		isRefreshing: false,
		isLiveUpdating: false,
		onRefreshData: vi.fn(),
		onOpenLiveSettings: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};

	return render(
		<TooltipProvider>
			<StoryHeader {...props} />
		</TooltipProvider>,
	);
}
