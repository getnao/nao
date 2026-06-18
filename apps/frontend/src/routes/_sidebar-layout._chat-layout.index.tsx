import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlusIcon, Settings } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { StoryItem } from '@/lib/stories-page';
import { buildStoryItems } from '@/lib/stories-page';
import { useSession } from '@/lib/auth-client';
import { capitalize, cn } from '@/lib/utils';
import { setActiveProjectId } from '@/lib/active-project';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { ViewerHome } from '@/components/viewer-home';
import { useAgentContext } from '@/contexts/agent.provider';
import { usePermissions } from '@/hooks/use-permissions';
import { SavedPromptSuggestions } from '@/components/chat-saved-prompt-suggestions';
import { ChatInput } from '@/components/chat-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MobileHeader } from '@/components/mobile-header';
import { ProjectSelector } from '@/components/project-selector';
import { trpc } from '@/main';
import { useTheme } from '@/contexts/theme.provider';
import { StoryCard } from '@/components/stories-groups';
import { useResizeObserver } from '@/hooks/use-resize-observer';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/')({
	component: RouteComponent,
});

function RouteComponent() {
	const { isViewer } = usePermissions();
	if (isViewer) {
		return <ViewerHome />;
	}
	return <HomePage />;
}

function HomePage() {
	const { data: session } = useSession();
	const username = session?.user?.name;
	const { messages } = useAgentContext();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const isInMultipleProjects = (projects.data?.length ?? 0) > 1;
	const showProjectSetupCue = project.isSuccess && project.data === null;
	const stateTitle = `${username ? capitalize(username) : ''}, what do you want to analyze?`;
	const theme = useTheme();
	const isEmptyState = messages.length === 0;
	const stories = useQuery({ ...trpc.story.listAll.queryOptions(), enabled: isEmptyState });
	const sharedStories = useQuery({
		...trpc.storyShare.list.queryOptions({ projectId: project.data?.id ?? '' }),
		enabled: isEmptyState && !!project.data?.id,
	});
	const favorites = useQuery({ ...trpc.favorite.list.queryOptions(), enabled: isEmptyState });
	const folderItems = useQuery({ ...trpc.storyFolder.listItems.queryOptions(), enabled: isEmptyState });
	const folderTree = useQuery({
		...trpc.storyFolder.listTree.queryOptions({ archived: false }),
		enabled: isEmptyState,
	});
	const storiesGridRef = useRef<HTMLDivElement>(null);
	const [storyCols, setStoryCols] = useState(STORY_CARD_MAX_COLS);
	const hasStories = (stories.data?.length ?? 0) > 0;
	useResizeObserver(
		storiesGridRef,
		(el) => {
			setStoryCols(computeStoryCols(el.getBoundingClientRect().width));
		},
		[hasStories],
	);
	const folderItemMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const item of folderItems.data ?? []) {
			map.set(item.storyId, item.folderId);
		}
		return map;
	}, [folderItems.data]);
	const latestStoryItems = useMemo(() => {
		const items = buildStoryItems({
			userStories: stories.data ?? [],
			sharedStories: sharedStories.data ?? [],
			currentUserName: session?.user?.name ?? username ?? '',
			favoriteStoryIds: favorites.data?.storyIds,
			folderItemMap,
			folders: folderTree.data ?? [],
		});
		return [...items]
			.sort((a, b) => {
				const rankDiff = storyPriorityRank(a) - storyPriorityRank(b);
				if (rankDiff !== 0) {
					return rankDiff;
				}
				return b.createdAt.getTime() - a.createdAt.getTime();
			})
			.slice(0, storyCols);
	}, [
		stories.data,
		sharedStories.data,
		session?.user?.name,
		storyCols,
		username,
		favorites.data,
		folderItemMap,
		folderTree.data,
	]);
	const storyGroups = useMemo(() => buildStoryGroups(latestStoryItems), [latestStoryItems]);
	const hasMoreStories = (stories.data?.length ?? 0) > storyCols;

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

	const isDark =
		theme.theme === 'dark' ||
		(theme.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	const logoSrc = isDark ? '/darkLogo.svg' : '/lightLogo.svg';

	return (
		<div className='relative flex flex-col h-full flex-1 min-w-72 overflow-hidden justify-center'>
			<MobileHeader />
			{project.data && isInMultipleProjects && (
				<div className='-ml-2 px-4 pt-3 md:px-8 md:pt-4 max-md:hidden'>
					<ProjectSelector
						projects={projects.data ?? []}
						currentProjectId={project.data.id}
						onChange={handleProjectChange}
						triggerVariant='ghost'
					/>
				</div>
			)}
			{messages.length ? (
				<>
					<ChatMessages />
					<ChatInput />
				</>
			) : (
				<>
					<div
						className={cn(
							'relative flex flex-col items-center justify-center gap-4 p-4 w-full flex-1',
							showProjectSetupCue ? '' : latestStoryItems.length > 0 ? 'mt-30' : '-mt-30',
						)}
					>
						{showProjectSetupCue ? (
							<Card className='w-full max-w-xl border shadow-none'>
								<CardContent className='flex flex-col gap-4 px-5 py-5'>
									<div className='flex flex-col items-center gap-8 text-left'>
										<div className='mt-0.5 rounded-full bg-amber-500/10 p-6 text-amber-600 dark:text-amber-400'>
											<Settings className='size-8' strokeWidth={1.5} />
										</div>
										<div className='gap-3 flex flex-col items-center'>
											<p className='font-medium text-foreground'>
												Set up a project to start analyzing data
											</p>
											<p className='text-sm text-foreground'>
												Open project settings to connect a project before starting a chat.
											</p>
										</div>
										<Button asChild variant='ghost' className='border rounded-full bg-panel/50'>
											<Link to='/settings/project'>Get started</Link>
										</Button>
									</div>
								</CardContent>
							</Card>
						) : (
							<>
								<div className='font-borna relative z-10 text-xl md:text-3xl tracking-tight text-center px-6 mb-6'>
									{stateTitle}
								</div>
								<div className='relative flex w-full max-w-3xl mx-auto flex-col gap-4'>
									<img
										src={logoSrc}
										alt=''
										aria-hidden
										className='pointer-events-none absolute -top-60 left-1/2 -translate-x-1/2 w-full max-w-2xl select-none -z-10'
									/>
									<ChatInput />
									<SavedPromptSuggestions />
								</div>
								{latestStoryItems.length > 0 && (
									<div className='flex flex-col gap-3 w-full px-4 py-6 max-w-3xl mx-auto'>
										<div
											ref={storiesGridRef}
											className='grid gap-x-5 gap-y-2'
											style={{
												gridTemplateColumns: `repeat(${storyCols}, minmax(0, 1fr))`,
											}}
										>
											{renderStoryGroupHeaders(storyGroups)}
											{latestStoryItems.map((item, index) => (
												<div key={item.id} style={{ gridColumn: index + 1, gridRow: 2 }}>
													<StoryCard item={item} displayMode='grid' showArchived={false} />
												</div>
											))}
										</div>
										{hasMoreStories && (
											<button
												type='button'
												onClick={() => navigate({ to: '/stories', search: { folderId: null } })}
												className={cn(
													'h-9 rounded-lg border border-dashed border-muted-foreground/20 px-3',
													'flex items-center gap-2 text-muted-foreground/50 bg-sidebar dark:bg-background',
													'hover:border-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer',
												)}
											>
												<div className='flex items-center justify-center gap-2 flex-1 min-w-0 pl-1.5'>
													<PlusIcon className='size-3 shrink-0' />
													<span className='text-xs truncate'>Show more</span>
												</div>
											</button>
										)}
									</div>
								)}
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}

const STORY_CARD_MIN_WIDTH = 170;
const STORY_CARD_GAP = 20;
const STORY_CARD_MAX_COLS = 3;

type StoryGroup = { key: 'favorites' | 'pinned' | 'latest'; label: string; items: StoryItem[] };

function storyPriorityRank(item: StoryItem): number {
	if (item.isFavorited) {
		return 0;
	}
	if (isPinnedStory(item)) {
		return 1;
	}
	return 2;
}

function buildStoryGroups(items: StoryItem[]): StoryGroup[] {
	const favorites = items.filter((item) => item.isFavorited);
	const pinned = items.filter((item) => !item.isFavorited && isPinnedStory(item));
	const latest = items.filter((item) => !item.isFavorited && !isPinnedStory(item));
	const groups: StoryGroup[] = [
		{
			key: 'favorites',
			label: pluralize('Favorite story', 'Favorite stories', favorites.length),
			items: favorites,
		},
		{ key: 'pinned', label: pluralize('Pinned story', 'Pinned stories', pinned.length), items: pinned },
		{ key: 'latest', label: pluralize('Latest story', 'Latest stories', latest.length), items: latest },
	];
	return groups.filter((group) => group.items.length > 0);
}

function renderStoryGroupHeaders(groups: StoryGroup[]) {
	let startColumn = 1;
	return groups.map((group) => {
		const column = `${startColumn} / span ${group.items.length}`;
		startColumn += group.items.length;
		return (
			<div
				key={group.key}
				className='text-md text-foreground font-medium'
				style={{ gridColumn: column, gridRow: 1 }}
			>
				{group.label}
			</div>
		);
	});
}

function computeStoryCols(containerWidth: number) {
	const n = Math.floor((containerWidth + STORY_CARD_GAP) / (STORY_CARD_MIN_WIDTH + STORY_CARD_GAP));
	return Math.max(1, Math.min(n, STORY_CARD_MAX_COLS));
}

function isPinnedStory(item: StoryItem): boolean {
	return item.isPinned || (item.sharing?.isPinned ?? false);
}

function pluralize(singular: string, plural: string, count: number): string {
	return count === 1 ? singular : plural;
}
