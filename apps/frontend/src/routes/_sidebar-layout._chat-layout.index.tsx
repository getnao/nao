import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, MessageCircle, PlusIcon, Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { StoryItem } from '@/lib/stories-page';

import { ChatInput } from '@/components/chat-input';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { SavedPromptSuggestions } from '@/components/chat-saved-prompt-suggestions';
import { MobileHeader } from '@/components/mobile-header';
import { ProjectSwitcher } from '@/components/project-selector';
import { StoryCard } from '@/components/stories-groups';
import { ViewerHome } from '@/components/viewer-home';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { useTheme } from '@/contexts/theme.provider';
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
	const isCloud = useIsCloud();
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
							showProjectSetupCue ? '' : latestStoryItems.length > 0 ? 'mt-30' : '-mt-30',
						)}
					>
						{showProjectSetupCue ? (
							isCloud ? (
								<>
									<div className='font-borna relative z-10 text-xl md:text-3xl tracking-tight text-center px-6 mb-6'>
										Welcome {username ? capitalize(username) : ''}! Let's get started.
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
									<div className='flex w-full max-w-3xl justify-center px-4 py-6'>
										<HomeLinkCard
											to='/onboarding'
											label='Guided setup'
											title='Set up your nao project'
											subtitle='Chat with the onboarding agent'
											icon={<MessageCircle className='size-5' />}
										/>
									</div>
								</>
							) : (
								<div className='flex w-full max-w-3xl justify-center px-4 py-6'>
									<HomeLinkCard
										to='/settings/project'
										label='Project required'
										title='Configure your nao project'
										subtitle='Set NAO_DEFAULT_PROJECT_PATH to start chatting'
										icon={<Settings className='size-5' />}
									/>
								</div>
							)
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
	icon,
}: {
	to: '/onboarding' | '/settings/project';
	label: string;
	title: string;
	subtitle: string;
	icon: React.ReactNode;
}) {
	return (
		<Link
			to={to}
			className={cn(
				'group relative flex min-h-28 w-full max-w-sm items-center gap-4 overflow-hidden rounded-xl border p-4 text-left',
				'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2',
				'border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-background focus-visible:ring-emerald-500/50',
			)}
		>
			<div className='absolute -right-8 -top-8 size-24 rounded-full bg-emerald-500/15 blur-2xl transition-opacity group-hover:opacity-100' />
			<div className='relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'>
				{icon}
			</div>
			<div className='relative min-w-0 flex-1'>
				<span className='mb-1 block text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-300'>
					{label}
				</span>
				<span className='block text-sm font-semibold text-foreground'>{title}</span>
				<span className='mt-1 block text-xs leading-relaxed text-muted-foreground'>{subtitle}</span>
			</div>
			<div className='relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-background/80 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground'>
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
