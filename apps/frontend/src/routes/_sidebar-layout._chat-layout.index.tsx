import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlusIcon, Settings } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { buildStoryItems } from '@/lib/stories-page';
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
	const emptyStateTitle = showProjectSetupCue
		? 'Set up a project to start analyzing data'
		: `${username ? capitalize(username) : ''}, what do you want to analyze?`;
	const theme = useTheme();
	const isEmptyState = messages.length === 0;
	const stories = useQuery({ ...trpc.story.listAll.queryOptions(), enabled: isEmptyState });
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
			sharedStories: [],
			currentUserName: session?.user?.name ?? username ?? '',
			favoriteStoryIds: favorites.data?.storyIds,
			folderItemMap,
			folders: folderTree.data ?? [],
		});
		return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, storyCols);
	}, [stories.data, session?.user?.name, storyCols, username, favorites.data, folderItemMap, folderTree.data]);
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
							latestStoryItems.length > 0 ? 'mt-30' : '-mt-30',
						)}
					>
						<div className='font-borna relative z-10 text-xl md:text-3xl tracking-tight text-center px-6 mb-6'>
							{emptyStateTitle}
						</div>
						{showProjectSetupCue ? (
							<Card className='w-full max-w-2xl border-amber-500/30 bg-amber-500/5 shadow-none'>
								<CardContent className='flex flex-col gap-4 px-5 py-5'>
									<div className='flex items-start gap-3 text-left'>
										<div className='mt-0.5 rounded-full bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400'>
											<Settings className='size-4' />
										</div>
										<div className='space-y-1'>
											<p className='font-medium text-foreground'>No project is configured yet</p>
											<p className='text-sm text-muted-foreground'>
												Open project settings to connect a project before starting a chat.
											</p>
										</div>
									</div>
									<div className='flex justify-start'>
										<Button asChild variant='secondary'>
											<Link to='/settings/project'>Open project settings</Link>
										</Button>
									</div>
								</CardContent>
							</Card>
						) : (
							<>
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
										<div className='flex items-center justify-between mb-2'>
											<span className='text-md text-foreground font-medium'>Latest stories</span>
										</div>
										<div
											ref={storiesGridRef}
											className='grid gap-5'
											style={{
												gridTemplateColumns: `repeat(${storyCols}, minmax(0, 1fr))`,
											}}
										>
											{latestStoryItems.map((item) => (
												<StoryCard
													key={item.id}
													item={item}
													displayMode='grid'
													showArchived={false}
												/>
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

function computeStoryCols(containerWidth: number) {
	const n = Math.floor((containerWidth + STORY_CARD_GAP) / (STORY_CARD_MIN_WIDTH + STORY_CARD_GAP));
	return Math.max(1, Math.min(n, STORY_CARD_MAX_COLS));
}
