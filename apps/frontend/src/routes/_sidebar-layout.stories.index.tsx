import { useCallback, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DisplayMode, GroupBy, OwnStoryListItem } from '@/lib/stories-page';
import { StoriesEmptyState, StoriesGroups, StoriesNoResults } from '@/components/stories-groups';
import { FavoritesSection, PinnedSection } from '@/components/stories-pinned-favorites';
import { StoriesToolbarControls } from '@/components/stories-toolbar-controls';
import { MobileHeader } from '@/components/mobile-header';
import { ProjectSelector } from '@/components/project-selector';
import { setActiveProjectId } from '@/lib/active-project';
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
	const queryClient = useQueryClient();
	const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
		getStoredSetting(STORIES_DISPLAY_KEY, ['grid', 'lines'], 'grid'),
	);
	const [groupBy, setGroupBy] = useState<GroupBy>(() =>
		getStoredSetting(STORIES_GROUP_KEY, ['ownership', 'date', 'user'], 'ownership'),
	);
	const [searchQuery, setSearchQuery] = useState('');
	const [showArchived, setShowArchived] = useState(false);

	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const isInMultipleProjects = (projects.data?.length ?? 0) > 1;
	const activeProjectId = project.data?.id;

	const userStories = useQuery(trpc.story.listAll.queryOptions({ projectId: activeProjectId }));
	const standaloneStories = useQuery(trpc.story.listStandalone.queryOptions());
	const sharedStories = useQuery(trpc.storyShare.list.queryOptions({ projectId: activeProjectId }));
	const favoriteStoryIds = useQuery(
		trpc.story.listFavorites.queryOptions({ projectId: activeProjectId }),
	);
	const archivedStories = useQuery({
		...trpc.story.listArchived.queryOptions({ projectId: activeProjectId }),
		enabled: showArchived,
	});
	const archivedStandaloneStories = useQuery({
		...trpc.story.listStandaloneArchived.queryOptions(),
		enabled: showArchived,
	});

	const currentUserName = session?.user?.name ?? 'Me';
	const currentUserId = session?.user?.id;

	const handleProjectChange = useCallback(
		async (projectId: string) => {
			if (!activeProjectId || projectId === activeProjectId) {
				return;
			}
			setActiveProjectId(projectId);
			await queryClient.invalidateQueries();
		},
		[activeProjectId, queryClient],
	);

	const allItems = useMemo(() => {
		const mapStandalone = (
			stories:
				| {
						id: string;
						storySlug: string;
						title: string;
						createdAt: Date;
						summary: OwnStoryListItem['summary'];
				  }[]
				| undefined,
		): OwnStoryListItem[] | undefined =>
			stories?.map((s) => ({
				id: s.id,
				chatId: null,
				storySlug: s.storySlug,
				title: s.title,
				createdAt: s.createdAt,
				summary: s.summary,
				isStandalone: true,
			}));

		if (showArchived) {
			return buildStoryItems({
				userStories: archivedStories.data ?? [],
				standaloneStories: mapStandalone(archivedStandaloneStories.data),
				sharedStories: [],
				currentUserId,
				currentUserName,
				favoriteStoryIds: favoriteStoryIds.data ?? [],
			});
		}
		return buildStoryItems({
			userStories: userStories.data ?? [],
			standaloneStories: mapStandalone(standaloneStories.data),
			sharedStories: sharedStories.data ?? [],
			currentUserId,
			currentUserName,
			favoriteStoryIds: favoriteStoryIds.data ?? [],
		});
	}, [
		showArchived,
		userStories.data,
		standaloneStories.data,
		sharedStories.data,
		archivedStories.data,
		archivedStandaloneStories.data,
		currentUserId,
		currentUserName,
		favoriteStoryIds.data,
	]);

	const filteredItems = useMemo(() => filterStories(allItems, searchQuery), [allItems, searchQuery]);

	const pinnedItems = useMemo(
		() => (!showArchived ? filteredItems.filter((i) => i.isPinned) : []),
		[filteredItems, showArchived],
	);

	const favoriteItems = useMemo(
		() => (!showArchived ? filteredItems.filter((i) => !i.isPinned && i.isFavorited) : []),
		[filteredItems, showArchived],
	);

	const restItems = useMemo(
		() => filteredItems.filter((i) => showArchived || (!i.isPinned && !i.isFavorited)),
		[filteredItems, showArchived],
	);

	const groups = useMemo(() => groupStories(restItems, groupBy), [restItems, groupBy]);

	const isLoading = showArchived
		? archivedStories.isLoading || archivedStandaloneStories.isLoading
		: userStories.isLoading || standaloneStories.isLoading || sharedStories.isLoading;
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
					<div className='flex items-center gap-3 min-w-0'>
						<h1 className='text-xl font-semibold tracking-tight shrink-0'>
							{showArchived ? 'Archived Stories' : 'Stories'}
						</h1>
						{project.data && isInMultipleProjects && (
							<ProjectSelector
								projects={projects.data ?? []}
								currentProjectId={project.data.id}
								onChange={handleProjectChange}
								triggerVariant='ghost'
								triggerClassName='h-8 text-sm'
							/>
						)}
					</div>
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

				{!showArchived && pinnedItems.length > 0 && (
					<PinnedSection items={pinnedItems} displayMode={displayMode} className='mb-6' />
				)}

				{!showArchived && favoriteItems.length > 0 && (
					<FavoritesSection items={favoriteItems} displayMode={displayMode} className='mb-6' />
				)}

				{!isLoading && !isEmpty && groups.length === 0 && searchQuery.trim() && (
					<StoriesNoResults query={searchQuery} />
				)}
				<StoriesGroups groups={groups} displayMode={displayMode} showArchived={showArchived} />
			</div>
		</div>
	);
}
