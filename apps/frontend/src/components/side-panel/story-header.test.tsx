// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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
	StoryDownload: () => null,
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
