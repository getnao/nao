import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { DisplayMode, GroupBy } from '@/lib/stories-page';
import { StoriesEmptyState, StoriesGroups, StoriesNoResults } from '@/components/stories-groups';
import { StoriesToolbarControls } from '@/components/stories-toolbar-controls';
import { MobileHeader } from '@/components/mobile-header';
import { useSession } from '@/lib/auth-client';
import {
	STORIES_DISPLAY_KEY,
	STORIES_GROUP_KEY,
	buildStoryItems,
	filterStories,
	getStoredSetting,
	groupStories,
} from '@/lib/stories-page';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/')({
	component: StoriesPage,
});

function StoriesPage() {
	const { data: session } = useSession();
	const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
		getStoredSetting(STORIES_DISPLAY_KEY, ['grid', 'lines'], 'grid'),
	);
	const [groupBy, setGroupBy] = useState<GroupBy>(() =>
		getStoredSetting(STORIES_GROUP_KEY, ['ownership', 'date', 'user'], 'ownership'),
	);
	const [searchQuery, setSearchQuery] = useState('');
	const [showArchived, setShowArchived] = useState(false);

	const userStories = useQuery(trpc.story.listAll.queryOptions());
	const sharedStories = useQuery(trpc.storyShare.list.queryOptions());
	const archivedStories = useQuery({
		...trpc.story.listArchived.queryOptions(),
		enabled: showArchived,
	});

	const currentUserName = session?.user?.name ?? 'Me';
	const currentUserId = session?.user?.id;

	const allItems = useMemo(() => {
		if (showArchived) {
			return buildStoryItems({
				userStories: archivedStories.data ?? [],
				sharedStories: [],
				currentUserId,
				currentUserName,
			});
		}
		return buildStoryItems({
			userStories: userStories.data ?? [],
			sharedStories: sharedStories.data ?? [],
			currentUserId,
			currentUserName,
		});
	}, [showArchived, userStories.data, sharedStories.data, archivedStories.data, currentUserId, currentUserName]);

	const filteredItems = useMemo(() => {
		return filterStories(allItems, searchQuery);
	}, [allItems, searchQuery]);

	const groups = useMemo(() => groupStories(filteredItems, groupBy), [filteredItems, groupBy]);

	const isLoading = showArchived ? archivedStories.isLoading : userStories.isLoading || sharedStories.isLoading;
	const isEmpty = allItems.length === 0 && !isLoading;

	function handleDisplayChange(mode: DisplayMode) {
		setDisplayMode(mode);
		localStorage.setItem(STORIES_DISPLAY_KEY, mode);
	}

	function handleGroupChange(value: GroupBy) {
		setGroupBy(value);
		localStorage.setItem(STORIES_GROUP_KEY, value);
	}

	function handleShowArchivedChange(value: boolean) {
		setShowArchived(value);
		setSearchQuery('');
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel'>
			<MobileHeader />
			<div className='w-full px-4 py-6 md:px-8 md:py-10'>
				<div className='flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap'>
					<h1 className='text-xl font-semibold tracking-tight'>
						{showArchived ? 'Archived Stories' : 'Stories'}
					</h1>
					{(!isEmpty || showArchived) && (
						<StoriesToolbarControls
							searchQuery={searchQuery}
							onSearchQueryChange={setSearchQuery}
							groupBy={groupBy}
							onGroupByChange={handleGroupChange}
							displayMode={displayMode}
							onDisplayModeChange={handleDisplayChange}
							showArchived={showArchived}
							onShowArchivedChange={handleShowArchivedChange}
						/>
					)}
				</div>

				{isEmpty && !showArchived && <StoriesEmptyState />}

				{isEmpty && showArchived && (
					<p className='text-muted-foreground text-sm py-12 text-center'>No archived stories.</p>
				)}

				{!isLoading && !isEmpty && groups.length === 0 && searchQuery.trim() && (
					<StoriesNoResults query={searchQuery} />
				)}
				<StoriesGroups groups={groups} displayMode={displayMode} showArchived={showArchived} />
			</div>
		</div>
	);
}
