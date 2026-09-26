import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlusIcon, Settings, Sparkles } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { HomeFeedGroup, HomeFeedItem } from '@/lib/home-feed';
import { buildStoryItems } from '@/lib/stories-page';
import { useSession } from '@/lib/auth-client';
import { capitalize, cn } from '@/lib/utils';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { ProjectSwitcher } from '@/components/project-selector';
import { ViewerHome } from '@/components/viewer-home';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { usePermissions } from '@/hooks/use-permissions';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { SavedPromptSuggestions } from '@/components/chat-saved-prompt-suggestions';
import { ChatInput } from '@/components/chat-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MobileHeader } from '@/components/mobile-header';
import { trpc } from '@/main';
import { useTheme } from '@/contexts/theme.provider';
import { StoryCard } from '@/components/stories-groups';
import { HomeRecommendedChatCard } from '@/components/home-recommended-chat-card';
import { HomeStoriesModeSelect } from '@/components/home-stories-mode-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useHomeFeed } from '@/hooks/use-home-feed';
import { useResizeObserver } from '@/hooks/use-resize-observer';
import { useMultiProject } from '@/hooks/use-multi-project';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/')({
	validateSearch: (search: Record<string, unknown>): { admin?: boolean } => ({
		admin: search.admin === true || search.admin === 'true' ? true : undefined,
	}),
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
	const { setAdminMode } = useAgentContext();
	const messages = useAgentMessages();
	const { canChatWithNaoData } = usePermissions();
	const { admin: adminSearch } = Route.useSearch();
	const navigate = useNavigate();

	useEffect(() => {
		if (!canChatWithNaoData) {
			return;
		}
		setAdminMode(adminSearch === true);
	}, [canChatWithNaoData, adminSearch, setAdminMode]);

	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const switchProject = useProjectSwitch(project.data?.id);
	const multiProjectMode = useMultiProject();
	const showProjectSetupCue = project.isSuccess && project.data === null;
	const stateTitle = `${username ? capitalize(username) : ''}, what do you want to analyze?`;
	const theme = useTheme();
	const isEmptyState = messages.length === 0;
	const stories = useQuery({ ...trpc.story.listAll.queryOptions(), enabled: isEmptyState });
	const sharedStories = useQuery({
		...trpc.storyShare.list.queryOptions({ projectId: project.data?.id ?? '' }),
		enabled: isEmptyState && !!project.data?.id,
	});
	const favorites = useQuery({
		...trpc.favorite.list.queryOptions(),
		enabled: isEmptyState,
	});
	const folderItems = useQuery({
		...trpc.storyFolder.listItems.queryOptions(),
		enabled: isEmptyState,
	});
	const folderTree = useQuery({
		...trpc.storyFolder.listTree.queryOptions({ archived: false }),
		enabled: isEmptyState,
	});
	const storiesGridRef = useRef<HTMLDivElement>(null);
	const [storyCols, setStoryCols] = useState(STORY_CARD_MAX_COLS);
	const folderItemMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const item of folderItems.data ?? []) {
			map.set(item.storyId, item.folderId);
		}
		return map;
	}, [folderItems.data]);
	const storyItems = useMemo(
		() =>
			buildStoryItems({
				userStories: stories.data ?? [],
				sharedStories: sharedStories.data ?? [],
				currentUserName: session?.user?.name ?? username ?? '',
				favoriteStoryIds: favorites.data?.storyIds,
				folderItemMap,
				folders: folderTree.data ?? [],
			}),
		[
			stories.data,
			sharedStories.data,
			session?.user?.name,
			username,
			favorites.data,
			folderItemMap,
			folderTree.data,
		],
	);
	const feed = useHomeFeed({ storyItems, limit: storyCols, enabled: isEmptyState });
	const showFeed = feed.items.length > 0 || feed.isLoading;
	const hasMoreStories = (stories.data?.length ?? 0) > storyCols;
	useResizeObserver(
		storiesGridRef,
		(el) => {
			setStoryCols(computeStoryCols(el.getBoundingClientRect().width));
		},
		[showFeed],
	);

	const isDark =
		theme.theme === 'dark' ||
		(theme.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	const logoSrc = isDark ? '/darkLogo.svg' : '/lightLogo.svg';

	return (
		<div className='relative flex flex-col h-full flex-1 min-w-72 overflow-hidden justify-center'>
			<MobileHeader />
			{messages.length === 0 &&
				multiProjectMode === 'switch' &&
				project.data &&
				(projects.data?.length ?? 0) > 1 && (
					<div className='absolute top-0 left-0 z-10 -ml-2 px-4 pt-3 md:px-8 md:pt-4 max-md:hidden'>
						<ProjectSwitcher
							projects={projects.data ?? []}
							currentProjectId={project.data.id}
							onChange={switchProject}
							variant='inline'
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
							showProjectSetupCue ? '' : showFeed ? 'mt-30' : '-mt-30',
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
								{showFeed && (
									<div className='flex flex-col gap-3 w-full px-4 py-6 max-w-3xl mx-auto'>
										<div
											ref={storiesGridRef}
											className='grid gap-x-5 gap-y-2'
											style={{
												gridTemplateColumns: `repeat(${storyCols}, minmax(0, 1fr))`,
											}}
										>
											{feed.isLoading
												? renderFeedSkeleton(storyCols)
												: renderFeedGroupHeaders(feed.groups)}
											<div
												className='flex items-center'
												style={{ gridColumn: storyCols, gridRow: 1, justifySelf: 'end' }}
											>
												<HomeStoriesModeSelect value={feed.mode} onChange={feed.setMode} />
											</div>
											{!feed.isLoading &&
												feed.items.map((item, index) => renderFeedItem(item, index))}
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

function renderFeedGroupHeaders(groups: HomeFeedGroup[]) {
	let startColumn = 1;
	return groups.map((group, index) => {
		const column = `${startColumn} / span ${group.items.length}`;
		startColumn += group.items.length;
		const isLast = index === groups.length - 1;
		return (
			<div
				key={group.key}
				className={cn('text-md text-foreground font-medium truncate self-center', isLast && 'pr-24')}
				style={{ gridColumn: column, gridRow: 1 }}
			>
				{group.label}
			</div>
		);
	});
}

function renderFeedItem(item: HomeFeedItem, index: number) {
	return (
		<Fragment key={item.key}>
			<div style={{ gridColumn: index + 1, gridRow: 2 }}>
				{item.kind === 'story' ? (
					<StoryCard item={item.story} displayMode='grid' showArchived={false} />
				) : (
					<HomeRecommendedChatCard chat={item.chat} />
				)}
			</div>
			{item.reason && (
				<div
					className='flex items-center gap-1.5 px-1 text-xs text-muted-foreground'
					style={{ gridColumn: index + 1, gridRow: 3 }}
				>
					<Sparkles className='size-3 shrink-0' />
					<span className='truncate'>{item.reason}</span>
				</div>
			)}
		</Fragment>
	);
}

function renderFeedSkeleton(columns: number) {
	return (
		<>
			<Skeleton className='h-5 w-24 self-center' style={{ gridColumn: 1, gridRow: 1 }} />
			{Array.from({ length: columns }, (_, index) => (
				<Skeleton key={index} className='h-[150px]' style={{ gridColumn: index + 1, gridRow: 2 }} />
			))}
		</>
	);
}

function computeStoryCols(containerWidth: number) {
	const n = Math.floor((containerWidth + STORY_CARD_GAP) / (STORY_CARD_MIN_WIDTH + STORY_CARD_GAP));
	return Math.max(1, Math.min(n, STORY_CARD_MAX_COLS));
}
