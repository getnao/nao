import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';
import type { DisplayMode, GroupBy, SharedItem } from '@/lib/viewer-home';
import { MobileHeader } from '@/components/mobile-header';
import { ProjectSelector } from '@/components/project-selector';
import { ViewerToolbarControls } from '@/components/viewer-toolbar-controls';
import { ViewerEmptyState, ViewerGroups, ViewerNoResults } from '@/components/viewer-shared-items';
import { Spinner } from '@/components/ui/spinner';
import { VIEWER_DISPLAY_KEY, VIEWER_GROUP_KEY, filterItems, getStoredSetting, groupItems } from '@/lib/viewer-home';
import { setActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

export function ViewerHome() {
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const sharedChats = useQuery(trpc.sharedChat.list.queryOptions());
	const sharedStories = useQuery(trpc.storyShare.list.queryOptions());
	const [searchQuery, setSearchQuery] = useState('');
	const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
		getStoredSetting(VIEWER_DISPLAY_KEY, ['grid', 'lines'], 'grid'),
	);
	const [groupBy, setGroupBy] = useState<GroupBy>(() =>
		getStoredSetting(VIEWER_GROUP_KEY, ['type', 'date', 'author'], 'type'),
	);
	const isInMultipleProjects = (projects.data?.length ?? 0) > 1;

	const handleProjectChange = useCallback(
		async (projectId: string) => {
			if (!project.data || projectId === project.data.id) {
				return;
			}
			setActiveProjectId(projectId);
			await queryClient.invalidateQueries();
		},
		[project.data, queryClient],
	);

	function handleDisplayChange(mode: DisplayMode) {
		setDisplayMode(mode);
		localStorage.setItem(VIEWER_DISPLAY_KEY, mode);
	}

	function handleGroupChange(value: GroupBy) {
		setGroupBy(value);
		localStorage.setItem(VIEWER_GROUP_KEY, value);
	}

	const projectId = project.data?.id;

	const allItems: SharedItem[] = useMemo(() => {
		const storyItems: SharedItem[] = (sharedStories.data ?? [])
			.filter((s) => s.projectId === projectId)
			.map((s) => ({
				id: s.id,
				kind: 'story',
				title: s.title,
				authorName: s.authorName,
				createdAt: new Date(s.createdAt),
				summary: s.summary,
			}));
		const chatItems: SharedItem[] = (sharedChats.data ?? [])
			.filter((c) => c.projectId === projectId)
			.map((c) => ({
				id: c.id,
				kind: 'chat',
				title: c.title,
				authorName: c.authorName,
				createdAt: new Date(c.createdAt),
				messageBubbles: c.messageBubbles,
			}));
		return [...storyItems, ...chatItems];
	}, [sharedStories.data, sharedChats.data, projectId]);

	const filteredItems = useMemo(() => filterItems(allItems, searchQuery), [allItems, searchQuery]);
	const groups = useMemo(() => groupItems(filteredItems, groupBy), [filteredItems, groupBy]);

	const isLoading = sharedChats.isLoading || sharedStories.isLoading || project.isLoading;
	const isEmpty = allItems.length === 0 && !isLoading;

	const projectSelector = project.data && isInMultipleProjects && (
		<div className='-ml-2 px-4 pt-3 md:px-8 md:pt-4 max-md:hidden'>
			<ProjectSelector
				projects={projects.data ?? []}
				currentProjectId={project.data.id}
				onChange={handleProjectChange}
				triggerVariant='ghost'
			/>
		</div>
	);

	if (isLoading) {
		return (
			<div className='flex flex-col flex-1 bg-panel min-w-72 overflow-hidden'>
				<MobileHeader />
				{projectSelector}
				<div className='flex flex-1 items-center justify-center'>
					<Spinner />
				</div>
			</div>
		);
	}

	if (isEmpty) {
		return (
			<div className='flex flex-col flex-1 bg-panel min-w-72 overflow-hidden'>
				<MobileHeader />
				{projectSelector}
				<ViewerEmptyState />
			</div>
		);
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel min-w-72'>
			<MobileHeader />
			{projectSelector}
			<div className='w-full px-4 py-6 md:px-8 md:py-10'>
				<div className='flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap'>
					<h1 className='text-xl font-semibold tracking-tight'>Shared with me</h1>
					<ViewerToolbarControls
						searchQuery={searchQuery}
						onSearchQueryChange={setSearchQuery}
						groupBy={groupBy}
						onGroupByChange={handleGroupChange}
						displayMode={displayMode}
						onDisplayModeChange={handleDisplayChange}
					/>
				</div>

				{filteredItems.length === 0 && searchQuery.trim() ? (
					<ViewerNoResults query={searchQuery} />
				) : (
					<ViewerGroups groups={groups} displayMode={displayMode} />
				)}
			</div>
		</div>
	);
}
