import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useMatchRoute, useRouterState } from '@tanstack/react-router';
import { ArrowLeftFromLine, ArrowRightToLine, PlusIcon, ArrowLeft, ChevronRight, SearchIcon, X } from 'lucide-react';
import { ChatList } from './sidebar-chat-list';
import { ChatListItem } from './sidebar-chat-list-item';
import { SharedChatListItem } from './shared-chat-list-item';
import { SidebarUserMenu } from './sidebar-user-menu';
import { SidebarSettingsNav } from './sidebar-settings-nav';
import { Spinner } from './ui/spinner';

import StoryIcon from './ui/story-icon';
import { SidebarCommunity } from './sidebar-community';
import type { LucideIcon } from 'lucide-react';
import type { ChatListItem as ChatListItemType } from '@nao/backend/chat';
import type { SharedChatWithDetails } from '@nao/backend/shared-chat';
import { Button } from '@/components/ui/button';
import { cn, hideIf } from '@/lib/utils';
import { useChatListQuery } from '@/queries/use-chat-list-query';
import { useSidebar } from '@/contexts/sidebar';
import { useCommandMenuCallback } from '@/contexts/command-menu-callback';
import { useSectionActivity } from '@/hooks/use-chat-activity';
import NaoLogo from '@/components/icons/nao-logo.svg';
import { trpc } from '@/main';

type MixedItem = { kind: 'own'; data: ChatListItemType } | { kind: 'shared'; data: SharedChatWithDetails };

const normalizeDate = (v: Date | number | string): number => (v instanceof Date ? v.getTime() : Number(v));

export function Sidebar() {
	const chats = useChatListQuery();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const { isCollapsed, isMobile, isMobileOpen, closeMobile, toggle: toggleSidebar } = useSidebar();
	const { fire: openCommandMenu } = useCommandMenuCallback();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

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
							<div
								className={cn(
									'flex items-center justify-center p-2 mr-auto absolute left-0 z-0 transition-[opacity,visibility] duration-300',
									hideIf(effectiveIsCollapsed),
								)}
							>
								<NaoLogo className='size-5' />
							</div>

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
				<SidebarSettingsNav isCollapsed={effectiveIsCollapsed} isAdmin={isAdmin} />
			) : (
				<SidebarNav chats={chats.data?.chats || []} isCollapsed={effectiveIsCollapsed} />
			)}

			<div className={cn('mt-auto transition-[padding] duration-300', effectiveIsCollapsed ? 'p-1' : 'p-2')}>
				{isInSettings && <SidebarCommunity isCollapsed={effectiveIsCollapsed} />}
				<SidebarUserMenu isCollapsed={effectiveIsCollapsed} />
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

function SidebarNav({ chats, isCollapsed }: { chats: ChatListItemType[]; isCollapsed: boolean }) {
	const [starredOpen, setStarredOpen] = useState(() => localStorage.getItem('sidebar-starred-open') !== 'false');
	const [chatsOpen, setChatsOpen] = useState(() => localStorage.getItem('sidebar-chats-open') !== 'false');
	const [sharedOpen, setSharedOpen] = useState(false);

	const toggleStarred = useCallback(() => {
		setStarredOpen((prev) => {
			localStorage.setItem('sidebar-starred-open', String(!prev));
			return !prev;
		});
	}, []);

	const toggleChats = useCallback(() => {
		setChatsOpen((prev) => {
			localStorage.setItem('sidebar-chats-open', String(!prev));
			return !prev;
		});
	}, []);

	const { starred, regular, starredIds, regularIds } = useMemo(() => {
		const starredChats: ChatListItemType[] = [];
		const rest: ChatListItemType[] = [];
		for (const chat of chats) {
			if (chat.isStarred) {
				starredChats.push(chat);
			} else {
				rest.push(chat);
			}
		}
		return {
			starred: starredChats,
			regular: rest,
			starredIds: starredChats.map((c) => c.id),
			regularIds: rest.map((c) => c.id),
		};
	}, [chats]);

	const starredActivity = useSectionActivity(starredIds);
	const chatsActivity = useSectionActivity(regularIds);

	const sharedChatsQuery = useQuery(trpc.sharedChat.list.queryOptions());
	const allOwnChatIds = useMemo(() => new Set([...starredIds, ...regularIds]), [starredIds, regularIds]);
	const sharedWithMeChats = useMemo((): SharedChatWithDetails[] => {
		if (!sharedChatsQuery.data) {
			return [];
		}
		return sharedChatsQuery.data.filter((sc) => !allOwnChatIds.has(sc.chatId));
	}, [sharedChatsQuery.data, allOwnChatIds]);

	const mixedList = useMemo((): MixedItem[] => {
		const own: MixedItem[] = regular.map((chat) => ({ kind: 'own', data: chat }));
		const shared: MixedItem[] = sharedWithMeChats.map((sc) => ({ kind: 'shared', data: sc }));

		return [...own, ...shared].sort((a, b) => normalizeDate(b.data.createdAt) - normalizeDate(a.data.createdAt));
	}, [regular, sharedWithMeChats]);

	return (
		<div
			className={cn(
				'flex flex-col flex-1 overflow-hidden transition-[opacity,visibility] duration-300',
				hideIf(isCollapsed),
			)}
		>
			{starred.length > 0 && (
				<>
					<div className='px-2 space-y-0.5'>
						<SidebarSectionHeader
							label='Starred'
							isOpen={starredOpen}
							onToggle={toggleStarred}
							activity={starredActivity}
						/>
					</div>
					<ChatList
						chats={starred}
						className={cn(
							'w-72 flex-none transition-opacity duration-200',
							starredOpen ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden',
						)}
					/>
				</>
			)}

			<div className='px-2 space-y-0.5'>
				<ChatsSectionHeader
					isOpen={chatsOpen}
					onToggle={toggleChats}
					activity={chatsActivity}
					sharedOpen={sharedOpen}
					onToggleShared={() => setSharedOpen((prev) => !prev)}
				/>
			</div>

			{!sharedOpen ? (
				<div
					className={cn(
						'w-72 flex-1 overflow-y-auto px-2 space-y-1 transition-opacity duration-200',
						chatsOpen ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden',
					)}
				>
					{mixedList.length === 0 ? (
						<p className='text-sm text-muted-foreground text-center p-4'>
							No chats yet.
							<br />
							Start a new chat!
						</p>
					) : (
						mixedList.map((item) =>
							item.kind === 'own' ? (
								<ChatListItem key={item.data.id} chat={item.data} />
							) : (
								<SharedChatListItem key={item.data.id} sharedChat={item.data} />
							),
						)
					)}
				</div>
			) : (
				<div
					className={cn(
						'w-72 flex-1 flex-col overflow-y-auto px-2 space-y-1 gap-0.5',
						chatsOpen ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden',
					)}
				>
					{sharedWithMeChats.length === 0 ? (
						<p className='text-sm text-muted-foreground text-center p-4'>No chats shared with you.</p>
					) : (
						sharedWithMeChats.map((sc) => <SharedChatListItem key={sc.id} sharedChat={sc} />)
					)}
				</div>
			)}
		</div>
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

function ChatsSectionHeader({
	isOpen,
	onToggle,
	activity,
	sharedOpen,
	onToggleShared,
}: {
	isOpen: boolean;
	onToggle: () => void;
	activity?: { running: boolean; unread: boolean };
	sharedOpen: boolean;
	onToggleShared: () => void;
}) {
	return (
		<SidebarSectionHeader
			label='Chats'
			isOpen={isOpen}
			onToggle={onToggle}
			activity={activity}
			extra={
				<Button
					onClick={(e) => {
						e.stopPropagation();
						onToggleShared();
					}}
					className={cn(
						'transition-[opacity,border-color,background-color] duration-200 p-2 h-5 rounded-sm border',
						sharedOpen ? 'opacity-90' : 'opacity-0 group-hover:opacity-90',
						'border-border text-muted-foreground hover:text-muted-foreground',
						'hover:border-foreground hover:bg-foreground hover:text-background',
						sharedOpen && 'border-foreground bg-foreground text-background',
					)}
					variant='ghost-no-hover'
					size='sm'
				>
					<span className='text-[10px]'>Shared with me</span>
				</Button>
			}
		/>
	);
}
