// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoryHeader } from './story-header';
import type { StoryHeaderProps } from './story-header';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: undefined }),
}));

vi.mock('@/components/editable-story-title', () => ({
	EditableStoryTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock('@/components/story-download', () => ({
	StoryDownloadMenuItem: () => null,
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
				queryOptions: () => ({}),
			},
		},
		story: {
			listStories: {
				queryOptions: () => ({}),
			},
		},
	},
}));

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

describe('StoryHeader toolbar actions', () => {
	afterEach(cleanup);

	it('exposes Share as a top-level button and keeps download and favorite in the menu', () => {
		const onShare = vi.fn();
		renderHeader({ onShare, storyId: 'story-1' });

		fireEvent.click(screen.getByRole('button', { name: 'Share' }));

		expect(onShare).toHaveBeenCalledOnce();
		expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /favorites/i })).toBeNull();
		expect(screen.getByRole('button', { name: 'More actions' })).toBeDefined();
	});

	it('hides Share for readonly viewers but still offers the menu when they can download', () => {
		renderHeader({ isReadonlyMode: true, shareId: 'share-1' });

		expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
		expect(screen.getByRole('button', { name: 'More actions' })).toBeDefined();
	});
});

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
