// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedStoryPage } from './shared-story-page';

const mocks = vi.hoisted(() => ({
	queryResult: {
		data: undefined as SharedStory | undefined,
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ mutate: vi.fn(), isPending: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useSuspenseQuery: () => mocks.queryResult,
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock('@/components/highlight-bubble', () => ({
	HighlightBubble: () => <div>Ask selection</div>,
}));
vi.mock('@/components/story-ask-bar', () => ({
	STORY_ASK_BAR_INSET_STYLE: {},
	StoryAskBar: () => <div>Ask bar</div>,
}));
vi.mock('@/components/side-panel/side-panel', () => ({ SidePanel: () => null }));
vi.mock('@/components/side-panel/story-subscription-dialog', () => ({ StorySubscriptionDialog: () => null }));
vi.mock('@/components/story-embeds', () => ({
	StoryChartEmbed: () => null,
	StoryMapEmbed: () => null,
	StoryTableEmbed: () => null,
}));
vi.mock('@/components/story-page-body', () => ({ StoryPageBody: () => null }));
vi.mock('@/components/story-page-header', () => ({
	StoryPageHeader: ({ canDuplicate }: { canDuplicate?: boolean }) =>
		canDuplicate ? <button>Duplicate</button> : null,
}));
vi.mock('@/components/story-tabbed-content', () => ({ StoryTabbedContent: () => null }));
vi.mock('@/components/story-theme-provider', () => ({ useStoryThemeForCurrentMode: () => null }));
vi.mock('@/components/ui/spinner', () => ({ Spinner: () => <div>Loading story</div> }));
vi.mock('@/contexts/side-panel', () => ({
	SidePanelProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/contexts/text-selection', () => ({
	SelectionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/hooks/use-side-panel', () => ({
	useSidePanel: () => ({
		isVisible: false,
		currentStorySlug: null,
		setCurrentStorySlug: vi.fn(),
		currentStoryTabIndex: 0,
		setCurrentStoryTabIndex: vi.fn(),
		open: vi.fn(),
		close: vi.fn(),
		content: null,
		isAnimating: false,
		resizeHandleRef: { current: null },
	}),
}));
vi.mock('@/hooks/use-story-page-editor', () => ({
	useStoryPageEditor: () => ({
		viewMode: 'preview',
		setViewMode: vi.fn(),
		isCodeDirty: false,
		isCodeValid: true,
		handleSave: vi.fn(),
		handleCancel: vi.fn(),
		isSaving: false,
		code: '# Story',
		versionNav: {
			storedVersionNumber: null,
			isViewingLatest: true,
			currentVersion: 1,
			totalVersions: 1,
			goToPrevious: vi.fn(),
			goToNext: vi.fn(),
		},
	}),
}));
vi.mock('@/hooks/use-is-story-refreshing', () => ({ useIsStoryRefreshing: () => false }));
vi.mock('@/hooks/use-story-version-query-data', () => ({
	useStoryVersionQueryData: () => ({ queryData: {}, isPending: false }),
}));
vi.mock('@/hooks/use-track-view-duration', () => ({ useTrackViewDuration: vi.fn() }));
vi.mock('@/hooks/use-mentioned-stories', () => ({ useResolvedStory: () => ({ data: { isOwner: false } }) }));
vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { id: 'member-1' } } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		storyShare: {
			get: { queryOptions: () => ({}) },
			refreshData: { mutationOptions: () => ({}), mutationKey: () => [] },
		},
	},
}));

describe('shared Story chat controls', () => {
	beforeEach(() => {
		mocks.queryResult.data = undefined;
	});

	afterEach(cleanup);

	it('offers to duplicate the Story only when the share allows forking', () => {
		mocks.queryResult.data = createStory({ canFork: true });
		const { unmount } = render(<SharedStoryPage storyId='story-1' />);
		expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy();
		unmount();

		mocks.queryResult.data = createStory({ canFork: false });
		render(<SharedStoryPage storyId='story-1' />);
		expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
	});

	it('lets members ask about the Story, from the ask bar or a selection', () => {
		mocks.queryResult.data = createStory({ canFork: false });

		render(<SharedStoryPage storyId='story-1' />);

		expect(screen.getByText('Ask bar')).toBeTruthy();
		expect(screen.getByText('Ask selection')).toBeTruthy();
	});

	it('keeps viewers and archived Stories read-only', () => {
		mocks.queryResult.data = createStory({ userRole: 'viewer' });
		const { unmount } = render(<SharedStoryPage storyId='story-1' />);
		expect(screen.queryByText('Ask bar')).toBeNull();
		unmount();

		mocks.queryResult.data = createStory({ isArchived: true });
		render(<SharedStoryPage storyId='story-1' />);
		expect(screen.queryByText('Ask bar')).toBeNull();
	});
});

interface SharedStory {
	canFork: boolean;
	userId: string;
	userRole: 'user' | 'viewer';
	storyId: string;
	chatId: string;
	slug: string;
	title: string;
	authorName: string;
	code: string;
	queryData: Record<string, never>;
	isLive: boolean;
	cacheSchedule: string | null;
	cachedAt: Date | null;
	lastRefreshFailure: null;
	canRefresh: boolean;
	isArchived: boolean;
}

function createStory(overrides: Partial<SharedStory>): SharedStory {
	return {
		canFork: false,
		userId: 'owner-1',
		userRole: 'user',
		storyId: 'story-1',
		chatId: 'chat-1',
		slug: 'story',
		title: 'Story',
		authorName: 'Owner',
		code: '# Story',
		queryData: {},
		isLive: false,
		cacheSchedule: null,
		cachedAt: null,
		lastRefreshFailure: null,
		canRefresh: false,
		isArchived: false,
		...overrides,
	};
}
