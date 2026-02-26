import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { DisplayMode, GroupBy } from '@/lib/stories-page';
import { StoriesEmptyState, StoriesGroups, StoriesNoResults } from '@/components/stories-groups';
import { StoriesToolbarControls } from '@/components/stories-toolbar-controls';
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
	const userStories = useQuery(trpc.story.listAll.queryOptions());
	const sharedStories = useQuery(trpc.storyShare.list.queryOptions());

	const currentUserName = session?.user?.name ?? 'Me';
	const currentUserId = session?.user?.id;

	const allItems = useMemo(() => {
		return buildStoryItems({
			userStories: userStories.data ?? [],
			sharedStories: sharedStories.data ?? [],
			currentUserId,
			currentUserName,
		});
	}, [userStories.data, sharedStories.data, currentUserId, currentUserName]);

	const filteredItems = useMemo(() => {
		return filterStories(allItems, searchQuery);
	}, [allItems, searchQuery]);

	const groups = useMemo(() => groupStories(filteredItems, groupBy), [filteredItems, groupBy]);

	const isLoading = userStories.isLoading || sharedStories.isLoading;
	const isEmpty = allItems.length === 0 && !isLoading;

	function handleDisplayChange(mode: DisplayMode) {
		setDisplayMode(mode);
		localStorage.setItem(STORIES_DISPLAY_KEY, mode);
	}

	function handleGroupChange(value: GroupBy) {
		setGroupBy(value);
		localStorage.setItem(STORIES_GROUP_KEY, value);
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel'>
			<div className='w-full px-8 py-10'>
				<div className='flex items-center justify-between mb-8'>
					<h1 className='text-xl font-semibold tracking-tight'>Stories</h1>
					{!isEmpty && (
						<StoriesToolbarControls
							searchQuery={searchQuery}
							onSearchQueryChange={setSearchQuery}
							groupBy={groupBy}
							onGroupByChange={handleGroupChange}
							displayMode={displayMode}
							onDisplayModeChange={handleDisplayChange}
						/>
					)}
				</div>

				{isEmpty && <StoriesEmptyState />}

				{!isLoading && !isEmpty && groups.length === 0 && searchQuery.trim() && (
					<StoriesNoResults query={searchQuery} />
				)}
				<StoriesGroups groups={groups} displayMode={displayMode} />
			</div>
		</div>
	);
}
