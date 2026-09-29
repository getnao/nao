// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedStoryPage } from './_sidebar-layout.stories.shared.$shareId';

const mocks = vi.hoisted(() => ({
	queryResult: {
		data: undefined as SharedStory | undefined,
	},
	pendingQuery: new Promise<never>(() => {}),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ mutate: vi.fn(), isPending: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useSuspenseQuery: () => {
		if (!mocks.queryResult.data) {
			throw mocks.pendingQuery;
		}

		return mocks.queryResult;
	},
}));

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: object) => ({
		...options,
		useParams: () => ({ shareId: 'share-1' }),
	}),
	useNavigate: () => vi.fn(),
}));

vi.mock('@/components/asset-analytics-dialog', () => ({ AssetAnalyticsDialog: () => null }));
vi.mock('@/components/highlight-bubble', () => ({
	ForkBubble: () => <div>Fork selection</div>,
}));
vi.mock('@/components/selection-chat-panel', () => ({
	SelectionChatPanel: () => <div>Selection chat</div>,
}));
vi.mock('@/components/share-dialog.story', () => ({ ShareStoryDialog: () => null }));
vi.mock('@/components/side-panel/hooks/use-story-viewer-live-settings', () => ({
	useStoryViewerLiveSettings: () => ({
		isLive: false,
		isLiveTextDynamic: false,
		cacheSchedule: null,
		cacheScheduleDescription: null,
		isUpdating: false,
		isRefreshing: false,
		handleSaveSettings: vi.fn(),
		handleRefreshData: vi.fn(),
	}),
}));
vi.mock('@/components/side-panel/live-story-settings-dialog', () => ({ LiveStorySettingsDialog: () => null }));
vi.mock('@/components/side-panel/side-panel', () => ({ SidePanel: () => null }));
vi.mock('@/components/side-panel/story-subscription-dialog', () => ({ StorySubscriptionDialog: () => null }));
vi.mock('@/components/story-access-error', () => ({ StoryRouteError: () => null }));
vi.mock('@/components/story-embeds', () => ({
	StoryChartEmbed: () => null,
	StoryMapEmbed: () => null,
	StoryTableEmbed: () => null,
}));
vi.mock('@/components/story-page-body', () => ({ StoryPageBody: () => null }));
vi.mock('@/components/story-page-header', () => ({
	StoryPageHeader: ({ onOpenChat }: { onOpenChat?: () => void }) =>
		onOpenChat ? <button onClick={onOpenChat}>Discuss story</button> : null,
}));
vi.mock('@/components/story-tabbed-content', () => ({ StoryTabbedContent: () => null }));
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
vi.mock('@/hooks/use-story-version-query-data', () => ({
	useStoryVersionQueryData: () => ({ queryData: {}, isPending: false }),
}));
vi.mock('@/hooks/use-track-view-duration', () => ({ useTrackViewDuration: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { id: 'member-1' } } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		chatFork: {
			fork: { mutationOptions: () => ({}) },
		},
		storyShare: {
			get: { queryOptions: () => ({}) },
			refreshData: { mutationOptions: () => ({}) },
		},
	},
}));

describe('shared Story fork controls', () => {
	beforeEach(() => {
		mocks.queryResult.data = undefined;
	});

	afterEach(cleanup);

	it('keeps fork controls hidden while the Story is loading', () => {
		render(
			<Suspense fallback={<div>Loading story</div>}>
				<SharedStoryPage />
			</Suspense>,
		);

		expect(screen.getByText('Loading story')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Discuss story' })).toBeNull();
		expect(screen.queryByText('Fork selection')).toBeNull();
	});

	it('uses the fork capability returned with the shared Story', () => {
		mocks.queryResult.data = createStory({ canFork: true });

		render(<SharedStoryPage />);

		expect(screen.getByRole('button', { name: 'Discuss story' })).toBeTruthy();
		expect(screen.getByText('Fork selection')).toBeTruthy();
	});

	it('hides fork controls when the shared Story denies forking', () => {
		mocks.queryResult.data = createStory({ canFork: false });

		render(<SharedStoryPage />);

		expect(screen.queryByRole('button', { name: 'Discuss story' })).toBeNull();
		expect(screen.queryByText('Fork selection')).toBeNull();
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
		...overrides,
	};
}
