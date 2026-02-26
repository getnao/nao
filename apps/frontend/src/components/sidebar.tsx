import { ArrowLeftFromLine, ArrowRightToLine, PlusIcon, ArrowLeft, ChevronRight, SearchIcon } from 'lucide-react';
import { useEffect, useCallback, useState } from 'react';
import { Link, useNavigate, useMatchRoute } from '@tanstack/react-router';
import { ChatList } from './sidebar-chat-list';
import { SidebarUserMenu } from './sidebar-user-menu';
import { SidebarSettingsNav } from './sidebar-settings-nav';

import StoryIcon from './ui/story-icon';
import type { LucideIcon } from 'lucide-react';
import type { ChatListItem as ChatListItemType } from '@nao/backend/chat';
import { Button } from '@/components/ui/button';
import { cn, hideIf } from '@/lib/utils';
import { useChatListQuery } from '@/queries/use-chat-list-query';
import { useSidebar } from '@/contexts/sidebar';
import { useCommandMenuCallback } from '@/contexts/command-menu-callback';
import NaoLogoGreyscale from '@/components/icons/nao-logo-greyscale.svg';

export function Sidebar() {
	const chats = useChatListQuery();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const { isCollapsed, toggle: toggleSidebar } = useSidebar();
	const { fire: openCommandMenu } = useCommandMenuCallback();

	const isInSettings = matchRoute({ to: '/settings', fuzzy: true });
	const effectiveIsCollapsed = isInSettings ? false : isCollapsed;

	const handleStartNewChat = useCallback(() => {
		navigate({ to: '/' });
	}, [navigate]);

	// Keyboard shortcut: Shift+Cmd+O for new chat
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

	return (
		<div
			className={cn(
				'flex flex-col border-r border-sidebar-border transition-[width,background-color] duration-300 overflow-hidden',
				effectiveIsCollapsed ? 'w-13 bg-panel' : 'w-72 bg-sidebar',
			)}
		>
			<div className='p-2 flex flex-col gap-1'>
				{isInSettings ? (
					<Link
						to='/'
						className={cn(
							'flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
							'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground whitespace-nowrap',
							effectiveIsCollapsed ? 'px-2.5' : '',
						)}
					>
						<ArrowLeft className='size-4 shrink-0' />
						<span
							className={cn('transition-[opacity,visibility] duration-300', hideIf(effectiveIsCollapsed))}
						>
							Back to app
						</span>
					</Link>
				) : (
					<>
						<div className='flex items-center relative'>
							<div
								className={cn(
									'flex items-center justify-center p-2 mr-auto absolute left-0 z-0 transition-[opacity,visibility] duration-300',
									hideIf(effectiveIsCollapsed),
								)}
							>
								<NaoLogoGreyscale className='size-5' />
							</div>

							<Button
								variant='ghost'
								size='icon-md'
								onClick={() => toggleSidebar()}
								className={cn('text-muted-foreground ml-auto z-10')}
							>
								{effectiveIsCollapsed ? (
									<ArrowRightToLine className='size-4' />
								) : (
									<ArrowLeftFromLine className='size-4' />
								)}
							</Button>
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
							onClick={openCommandMenu}
						/>
						<SidebarMenuButton
							icon={StoryIcon as unknown as LucideIcon}
							label='Stories'
							shortcut=''
							isCollapsed={effectiveIsCollapsed}
							onClick={() => navigate({ to: '/stories' })}
						/>
					</>
				)}
			</div>

			{isInSettings ? (
				<SidebarSettingsNav isCollapsed={effectiveIsCollapsed} />
			) : (
				<SidebarNav chats={chats.data?.chats || []} isCollapsed={effectiveIsCollapsed} />
			)}

			<div className={cn('mt-auto transition-[padding] duration-300', effectiveIsCollapsed ? 'p-1' : 'p-2')}>
				<SidebarUserMenu isCollapsed={effectiveIsCollapsed} />
			</div>
		</div>
	);
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
				<kbd className='group-hover:opacity-100 opacity-0 absolute right-3 text-[10px] text-muted-foreground font-sans transition-opacity'>
					{shortcut}
				</kbd>
			</div>
		</Button>
	);
}

function SidebarNav({ chats, isCollapsed }: { chats: ChatListItemType[]; isCollapsed: boolean }) {
	const [chatsOpen, setChatsOpen] = useState(true);

	return (
		<div
			className={cn(
				'flex flex-col flex-1 overflow-hidden transition-[opacity,visibility] duration-300',
				hideIf(isCollapsed),
			)}
		>
			<div className='px-2 space-y-0.5'>
				<button
					onClick={() => setChatsOpen((prev) => !prev)}
					className='group flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors w-full text-left text-muted-foreground whitespace-nowrap cursor-pointer'
				>
					<span>Chats</span>
					<ChevronRight
						className={cn(
							'size-4 shrink-0 transition-[transform,opacity,rotate] duration-200 group-hover:opacity-100',
							chatsOpen ? 'opacity-100 rotate-90' : 'opacity-0 rotate-0',
						)}
					/>
				</button>
			</div>

			{chatsOpen && <ChatList chats={chats} className='w-72' />}
		</div>
	);
}
