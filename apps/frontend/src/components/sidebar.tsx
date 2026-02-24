import { ArrowLeftFromLine, ArrowRightToLine, PlusIcon, ArrowLeft } from 'lucide-react';
import { useEffect, useCallback } from 'react';
import { Link, useNavigate, useMatchRoute } from '@tanstack/react-router';
import { ChatList } from './sidebar-chat-list';
import { SidebarUserMenu } from './sidebar-user-menu';
import { SidebarSettingsNav } from './sidebar-settings-nav';

import { Button } from '@/components/ui/button';
import { cn, hideIf } from '@/lib/utils';
import { useChatListQuery } from '@/queries/use-chat-list-query';
import { useSidebar } from '@/contexts/sidebar';
import NaoLogoGreyscale from '@/components/icons/nao-logo-greyscale.svg';

export function Sidebar() {
	const chats = useChatListQuery();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const { isCollapsed, toggle: toggleSidebar } = useSidebar();

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
			<div className='p-2 flex flex-col gap-2'>
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
						<Button
							variant='outline'
							className={cn(
								'w-full justify-start relative group shadow-none transition-[padding,height,background-color] duration-300 p-[9px_!important]',
								effectiveIsCollapsed ? 'h-9' : '',
							)}
							onClick={handleStartNewChat}
						>
							<PlusIcon className='size-4' />
							<div
								className={cn(
									'flex items-center transition-[opacity,visibility] duration-300',
									hideIf(effectiveIsCollapsed),
								)}
							>
								<span>New Chat</span>
								<kbd className='group-hover:opacity-100 opacity-0 absolute right-3 text-[10px] text-muted-foreground font-sans transition-opacity'>
									⇧⌘O
								</kbd>
							</div>
						</Button>
					</>
				)}
			</div>

			{isInSettings ? (
				<SidebarSettingsNav isCollapsed={effectiveIsCollapsed} />
			) : (
				<ChatList
					chats={chats.data?.chats || []}
					className={cn('w-72 transition-[opacity,visibility] duration-300', hideIf(effectiveIsCollapsed))}
				/>
			)}

			<div className={cn('mt-auto transition-[padding] duration-300', effectiveIsCollapsed ? 'p-1' : 'p-2')}>
				<SidebarUserMenu isCollapsed={effectiveIsCollapsed} />
			</div>
		</div>
	);
}
