import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, PlusIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { StoryItem } from '@/lib/stories-page';

import { ChatInput } from '@/components/chat-input';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { ExampleProjectInfoCard } from '@/components/example-project-info-card';
import { SavedPromptSuggestions } from '@/components/chat-saved-prompt-suggestions';
import { MobileHeader } from '@/components/mobile-header';
import { ProjectSwitcher } from '@/components/project-selector';
import { StoryCard } from '@/components/stories-groups';
import { ViewerHome } from '@/components/viewer-home';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { useIsDarkMode } from '@/contexts/theme.provider';
import { useMultiProject } from '@/hooks/use-multi-project';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { useResizeObserver } from '@/hooks/use-resize-observer';
import { useSession } from '@/lib/auth-client';
import { buildStoryItems } from '@/lib/stories-page';
import { capitalize, cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/')({
	validateSearch: (search: Record<string, unknown>): { admin?: boolean; example?: boolean } => ({
		admin: search.admin === true || search.admin === 'true' ? true : undefined,
		example: search.example === true || search.example === 'true' ? true : undefined,
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
	const { admin: adminSearch, example: exampleSearch } = Route.useSearch();
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
	const isCloud = useIsCloud();
	const showProjectSetupCue = project.isSuccess && project.data === null;
	const showExampleProject = isCloud && (showProjectSetupCue || exampleSearch === true);
	const stateTitle = `${username ? capitalize(username) : ''}, what do you want to analyze?`;
	const isDark = useIsDarkMode();
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

	const logoSrc = isDark ? '/darkLogo.svg' : '/lightLogo.svg';
	const cardLogoSrc = isDark ? '/dark-card-logo.svg' : '/light-card-logo.svg';

	return (
		<div className='relative flex flex-col h-full flex-1 min-w-72 overflow-hidden justify-center'>
			<MobileHeader />
			{showExampleProject && (
				<div className='absolute left-3 top-14 z-10 w-[calc(100%-1.5rem)] max-w-xs md:left-4'>
					<ExampleProjectInfoCard />
				</div>
			)}
			{messages.length === 0 &&
				!showExampleProject &&
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
							showExampleProject || showProjectSetupCue
								? ''
								: latestStoryItems.length > 0
									? 'mt-30'
									: '-mt-30',
						)}
					>
						{showExampleProject ? (
							<>
								<div className='relative z-10 mb-6 max-w-2xl space-y-2 px-6 text-center'>
									<h1 className='font-borna text-xl tracking-tight md:text-3xl'>
										Try out nao through our Jaffle Shop data
									</h1>
									<p className='text-sm leading-relaxed text-muted-foreground'>
										{username ? `Welcome, ${capitalize(username)}! ` : ''}
										Just type what you’d like to know, nao will explore the data and turn it into a
										clear answer.
									</p>
								</div>
								<div className='relative flex w-full max-w-3xl mx-auto flex-col gap-4'>
									<img
										src={logoSrc}
										alt=''
										aria-hidden
										className='pointer-events-none absolute -top-60 left-1/2 -translate-x-1/2 w-full max-w-2xl select-none -z-10'
									/>
									<ChatInput variant='example' />
									<SavedPromptSuggestions />
								</div>
								{showProjectSetupCue && (
									<div className='flex w-full max-w-3xl justify-center px-4 py-6'>
										<HomeLinkCard
											to='/onboarding'
											label='Guided setup'
											title='Set up your nao project'
											subtitle='Chat with the onboarding agent'
											logoSrc={cardLogoSrc}
										/>
									</div>
								)}
							</>
						) : showProjectSetupCue ? (
							<div className='flex w-full max-w-3xl justify-center px-4 py-6'>
								<HomeLinkCard
									to='/settings/project'
									label='Project required'
									title='Configure your nao project'
									subtitle='Set NAO_DEFAULT_PROJECT_PATH to start chatting'
									logoSrc={cardLogoSrc}
								/>
							</div>
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
												<div key={item.storyId} style={{ gridColumn: index + 1, gridRow: 2 }}>
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

function HomeLinkCard({
	to,
	label,
	title,
	subtitle,
	logoSrc,
}: {
	to: '/onboarding' | '/settings/project';
	label: string;
	title: string;
	subtitle: string;
	logoSrc: string;
}) {
	return (
		<Link
			to={to}
			className={cn(
				'group relative flex min-h-36 w-full max-w-md items-end gap-6 overflow-hidden rounded-xl border border-violet/20 bg-background p-5 text-left shadow-xs',
				'transition-colors duration-200 hover:border-violet/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
			)}
		>
			<img
				src={logoSrc}
				alt=''
				aria-hidden
				className='pointer-events-none absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 scale-150 select-none'
			/>
			<div className='relative z-10 flex min-h-24 min-w-0 flex-1 flex-col justify-between'>
				<span className='block text-[10px] font-semibold uppercase tracking-[0.16em] text-primary'>
					{label}
				</span>
				<div className='max-w-72'>
					<span className='font-borna block text-lg font-medium tracking-tight text-foreground'>{title}</span>
					<span className='mt-1 block text-xs leading-relaxed text-muted-foreground'>{subtitle}</span>
				</div>
			</div>
			<div className='bg-brand-gradient-border group-hover:bg-brand-gradient-border-hover relative z-10 flex size-9 shrink-0 self-center items-center justify-center rounded-full border border-transparent text-[oklch(1_0_0)] transition-colors'>
				<ArrowRight className='size-4' />
			</div>
		</Link>
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
