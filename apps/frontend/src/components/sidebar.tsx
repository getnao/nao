import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useMatchRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, ArrowLeftFromLine, ArrowRightToLine, ChevronRight, PlusIcon, SearchIcon, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ChatFilterMenu } from './sidebar-chat-filter-menu';
import { ChatListItem } from './sidebar-chat-list-item';
import { SidebarCommunity } from './sidebar-community';
import { SidebarSettingsNav } from './sidebar-settings-nav';
import { SidebarUserMenu } from './sidebar-user-menu';
import { Spinner } from './ui/spinner';
import StoryIcon from './ui/story-icon';
import type { ChatFilterType, ChatGroup, ChatGroupBy, GroupedChatItem } from '@nao/shared/types';
import type { LucideIcon } from 'lucide-react';

import NaoLogo from '@/components/icons/nao-logo.svg';
import { Button } from '@/components/ui/button';
import { useCommandMenuCallback } from '@/contexts/command-menu-callback';
import { useSidebar } from '@/contexts/sidebar';
import { useChatViewPreferences } from '@/hooks/use-chat-view-preferences';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { getActiveProjectId, setActiveProjectId } from '@/lib/active-project';
import { cn, hideIf } from '@/lib/utils';
import { trpc } from '@/main';

export function Sidebar() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const matchRoute = useMatchRoute();
	const { isCollapsed, isMobile, isMobileOpen, closeMobile, toggle: toggleSidebar } = useSidebar();
	const { fire: openCommandMenu } = useCommandMenuCallback();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const license = useQuery(trpc.license.getStatus.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';
	const isCloud = config.data?.naoMode === 'cloud';
	const { groupBy, filters, setGroupBy, toggleFilter } = useChatViewPreferences();
	const hasLicense = license.data?.tokenProvided === true;

	const locationPath = useRouterState({ select: (s) => s.location.pathname });
	const isInSettings = matchRoute({ to: '/settings', fuzzy: true });
	const effectiveIsCollapsed = isMobile ? false : isCollapsed;

	useEffect(() => {
		if (isMobile && isMobileOpen) {
			closeMobile();
		}
	}, [locationPath]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleStartNewChat = useCallback(() => {
		navigate({ to: '/' });
		if (isMobile) {
			closeMobile();
		}
	}, [navigate, isMobile, closeMobile]);

	const handleNavigateStories = useCallback(() => {
		navigate({ to: '/stories' });
		if (isMobile) {
			closeMobile();
		}
	}, [navigate, isMobile, closeMobile]);

	const handleSearchChats = useCallback(() => {
		openCommandMenu();
		if (isMobile) {
			closeMobile();
		}
	}, [openCommandMenu, isMobile, closeMobile]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.shiftKey && e.metaKey && e.key.toLowerCase() === 'o') {
				e.preventDefault();
				handleStartNewChat();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleStartNewChat]);

	useEffect(() => {
		if (!project.data?.id) {
			return;
		}

		if (getActiveProjectId() !== project.data.id) {
			setActiveProjectId(project.data.id);
		}
	}, [project.data?.id]);

	const handleProjectChange = useCallback(
		async (projectId: string) => {
			if (!project.data || projectId === project.data.id) {
				return;
			}

			setActiveProjectId(projectId);
			await queryClient.invalidateQueries();
			if (isMobile) {
				closeMobile();
			}
		},
		[closeMobile, isMobile, project.data, queryClient],
	);

	const sidebarContent = (
		<div
			className={cn(
				'flex flex-col h-full overflow-hidden',
				isMobile
					? 'w-72 bg-sidebar'
					: cn(
							'border-r border-sidebar-border transition-[width,background-color] duration-300',
							effectiveIsCollapsed ? 'w-13 bg-panel' : 'w-72 bg-sidebar',
						),
			)}
		>
			<div className='p-2 flex flex-col gap-1'>
				{isInSettings ? (
					<div className='flex items-center relative'>
						<Link
							to='/'
							onClick={() => isMobile && closeMobile()}
							className={cn(
								'flex items-center gap-2 text-sm rounded-md transition-all duration-300',
								'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground whitespace-nowrap',
								effectiveIsCollapsed
									? 'w-0 opacity-0 overflow-hidden p-0'
									: 'flex-1 min-w-0 opacity-100 px-3 py-2',
							)}
						>
							<ArrowLeft className='size-4 shrink-0' />
							<span className='truncate'>Back to app</span>
						</Link>
						{!isMobile && (
							<Button
								variant='ghost'
								size='icon-md'
								onClick={() => toggleSidebar()}
								className='text-muted-foreground shrink-0'
							>
								{effectiveIsCollapsed ? (
									<ArrowRightToLine className='size-4' />
								) : (
									<ArrowLeftFromLine className='size-4' />
								)}
							</Button>
						)}
					</div>
				) : (
					<>
						<div className='flex items-center relative'>
							<button
								type='button'
								onClick={handleStartNewChat}
								aria-label='New chat'
								className={cn(
									'flex items-center justify-center p-2 mr-auto absolute left-0 z-0 rounded-md cursor-pointer hover:bg-sidebar-accent transition-[opacity,visibility,background-color] duration-300',
									hideIf(effectiveIsCollapsed),
								)}
							>
								<NaoLogo className='size-5' />
							</button>

							{isMobile ? (
								<Button
									variant='ghost'
									size='icon-md'
									onClick={closeMobile}
									className='text-muted-foreground ml-auto z-10'
								>
									<X className='size-4' />
								</Button>
							) : (
								<Button
									variant='ghost'
									size='icon-md'
									onClick={() => toggleSidebar()}
									className='text-muted-foreground ml-auto z-10'
								>
									{effectiveIsCollapsed ? (
										<ArrowRightToLine className='size-4' />
									) : (
										<ArrowLeftFromLine className='size-4' />
									)}
								</Button>
							)}
						</div>

						<SidebarMenuButton
							icon={PlusIcon}
							label='New chat'
							shortcut='⇧⌘O'
							isCollapsed={effectiveIsCollapsed}
							onClick={handleStartNewChat}
						/>
						<SidebarMenuButton
							icon={SearchIcon}
							label='Search chats'
							shortcut='⌘K'
							isCollapsed={effectiveIsCollapsed}
							onClick={handleSearchChats}
						/>
						<SidebarMenuButton
							icon={StoryIcon as unknown as LucideIcon}
							label='Stories'
							shortcut=''
							isCollapsed={effectiveIsCollapsed}
							onClick={handleNavigateStories}
						/>
					</>
				)}
			</div>

			{isInSettings ? (
				<SidebarSettingsNav
					isCollapsed={effectiveIsCollapsed}
					isAdmin={isAdmin}
					isCloud={isCloud}
					hasLicense={hasLicense}
					projects={projects.data ?? []}
					currentProjectId={project.data?.id}
					onProjectChange={handleProjectChange}
				/>
			) : (
				<SidebarNav isCollapsed={effectiveIsCollapsed} groupBy={groupBy} filters={filters} />
			)}

			<div className={cn('mt-auto transition-[padding] duration-300', effectiveIsCollapsed ? 'p-1' : 'p-2')}>
				{isInSettings && <SidebarCommunity isCollapsed={effectiveIsCollapsed} />}
				<SidebarUserMenu
					isCollapsed={effectiveIsCollapsed}
					chatFilterMenu={
						!isInSettings ? (
							<ChatFilterMenu
								groupBy={groupBy}
								filters={filters}
								onGroupByChange={setGroupBy}
								onFilterToggle={toggleFilter}
							/>
						) : undefined
					}
				/>
			</div>
		</div>
	);

	if (isMobile) {
		return (
			<>
				{isMobileOpen && (
					<div className='fixed inset-0 z-40 flex'>
						<div
							className='fixed inset-0 bg-black/50 animate-in fade-in duration-200'
							onClick={closeMobile}
						/>
						<div className='relative z-50 animate-in slide-in-from-left duration-200'>{sidebarContent}</div>
					</div>
				)}
			</>
		);
	}

	return sidebarContent;
}

function SidebarMenuButton({
	icon: Icon,
	label,
	shortcut,
	isCollapsed,
	onClick,
}: {
	icon: LucideIcon;
	label: string;
	shortcut: string;
	isCollapsed: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			variant='ghost'
			className={cn(
				'w-full justify-start relative group shadow-none transition-[padding,height,background-color] duration-300 p-[9px_!important]',
				isCollapsed ? 'h-9' : '',
			)}
			onClick={onClick}
		>
			<Icon className='size-4' />
			<div className={cn('flex items-center transition-[opacity,visibility] duration-300', hideIf(isCollapsed))}>
				<span>{label}</span>
				<kbd className='group-hover:opacity-100 opacity-0 absolute right-3 text-[10px] text-muted-foreground font-sans transition-opacity hidden md:inline'>
					{shortcut}
				</kbd>
			</div>
		</Button>
	);
}

function SidebarNav({
	isCollapsed,
	groupBy,
	filters,
}: {
	isCollapsed: boolean;
	groupBy: ChatGroupBy;
	filters: ChatFilterType[];
}) {
	const groupedChats = useQuery({
		...trpc.chat.listGrouped.queryOptions({ groupBy, filters }),
		placeholderData: keepPreviousData,
	});
	const groups = groupedChats.data?.groups;
	const isEmpty = groups && groups.every((g) => g.chats.length === 0);

	return (
		<div
			className={cn(
				'flex flex-col flex-1 overflow-y-auto transition-[opacity,visibility] duration-300',
				hideIf(isCollapsed),
			)}
		>
			{groups?.map((group) => (
				<GroupSection key={group.label} group={group} groupBy={groupBy} />
			))}

			{isEmpty && (
				<p className='text-sm text-muted-foreground text-center p-4'>
					No chats yet.
					<br />
					Start a new chat!
				</p>
			)}
		</div>
	);
}

const GROUP_INITIAL_COUNT = 10;

function GroupSection({ group, groupBy }: { group: ChatGroup; groupBy: ChatGroupBy }) {
	const [isOpen, setIsOpen] = useState(true);
	const [expanded, setExpanded] = useState(false);
	const hasMore = group.chats.length > GROUP_INITIAL_COUNT;
	const visibleChats = expanded ? group.chats : group.chats.slice(0, GROUP_INITIAL_COUNT);

	if (group.chats.length === 0) {
		return null;
	}

	return (
		<>
			<div className='px-2 space-y-0.5'>
				<SidebarSectionHeader label={group.label} isOpen={isOpen} onToggle={() => setIsOpen((p) => !p)} />
			</div>

			{isOpen && (
				<div className='px-2 space-y-1'>
					{visibleChats.map((item) =>
						item.kind === 'shared' ? (
							<SharedChatGroupItem key={`shared-${item.shareId}`} item={item} groupBy={groupBy} />
						) : (
							<ChatListItem key={item.id} chat={item} />
						),
					)}

					{hasMore && (
						<button
							type='button'
							onClick={() => setExpanded((p) => !p)}
							className='px-3 py-1 text-xs text-muted-foreground cursor-pointer transition-colors hover:text-foreground'
						>
							{expanded ? 'Show less' : 'Show more'}
						</button>
					)}
				</div>
			)}
		</>
	);
}

function SharedChatGroupItem({ item, groupBy }: { item: GroupedChatItem; groupBy: ChatGroupBy }) {
	const timeAgo = useTimeAgo(item.updatedAt);

	return (
		<Link
			params={{ shareId: item.shareId! }}
			to='/shared-chat/$shareId'
			className='group relative w-full rounded-md px-3 py-2 transition-[background-color,padding,opacity] min-w-0 flex-1 flex gap-2 items-center'
			inactiveProps={{ className: 'text-sidebar-foreground hover:bg-sidebar-accent opacity-75' }}
			activeProps={{ className: 'text-foreground bg-sidebar-accent font-medium' }}
		>
			<div className='truncate text-sm mr-auto'>{item.title}</div>
			<div className='text-xs text-muted-foreground whitespace-nowrap'>
				{groupBy === 'ownership' ? timeAgo.humanReadable : `by ${item.ownerName}`}
			</div>
		</Link>
	);
}

function SidebarSectionHeader({
	label,
	isOpen,
	onToggle,
	activity,
	extra,
}: {
	label: string;
	isOpen: boolean;
	onToggle: () => void;
	activity?: { running: boolean; unread: boolean };
	extra?: React.ReactNode;
}) {
	const showIndicator = !isOpen && activity;

	return (
		<button
			onClick={onToggle}
			className='group relative flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors w-full text-left text-muted-foreground whitespace-nowrap cursor-pointer'
		>
			<span>{label}</span>
			<ChevronRight
				className={cn(
					'size-4 shrink-0 transition-[transform,opacity,rotate] duration-200 group-hover:opacity-100',
					isOpen ? 'opacity-100 rotate-90' : 'opacity-0 rotate-0',
				)}
			/>
			<div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2'>
				{showIndicator && activity.running && <Spinner className='size-3' />}
				{showIndicator && !activity.running && activity.unread && (
					<span className='size-1.5 rounded-full bg-primary' />
				)}
				{!showIndicator && extra}
			</div>
		</button>
	);
}
