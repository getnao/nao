import { ArrowLeftFromLine, ArrowRightToLine, PlusIcon } from 'lucide-react';
import { useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChatList } from './sidebar-chat-list';
import { SidebarUserMenu } from './sidebar-user-menu';

import { Button } from '@/components/ui/button';
import { cn, hideIf } from '@/lib/utils';
import { useChatListQuery } from '@/queries/useChatListQuery';
import { useSidebar } from '@/contexts/sidebar.provider';

export function Sidebar() {
	const chats = useChatListQuery();
	const navigate = useNavigate();
	const { isCollapsed, toggleSidebar } = useSidebar();

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
				'flex flex-col border-r border-sidebar-border transition-all duration-300 overflow-hidden',
				isCollapsed ? 'w-13 bg-panel' : 'w-72 bg-sidebar',
			)}
		>
			<div className='p-2 flex flex-col gap-2'>
				<div className='flex items-center'>
					{isCollapsed ? (
						<Button
							variant='ghost'
							size='icon-md'
							onClick={toggleSidebar}
							className={cn('text-muted-foreground')}
						>
							<ArrowRightToLine className='size-4' />
						</Button>
					) : (
						<>
							<div className={cn('flex items-center justify-center p-2 mr-auto')}>
								<img src='/nao-logo-greyscale.svg' alt='nao logo' className='size-5 rounded' />
							</div>

							<Button
								variant='ghost'
								size='icon-md'
								onClick={toggleSidebar}
								className={cn('text-muted-foreground')}
							>
								<ArrowLeftFromLine className='size-4' />
							</Button>
						</>
					)}
				</div>

				<Button
					variant='outline'
					className={cn(
						'w-full justify-start relative group shadow-none transition-[padding,height,width,background-color] p-[9px_!important]',
						isCollapsed ? 'h-9 w-9' : '',
					)}
					onClick={handleStartNewChat}
				>
					<PlusIcon className='size-4' />
					<div className={cn('flex items-center transition-[opacity,visibility]', hideIf(isCollapsed))}>
						<span>New Chat</span>
						<kbd className='group-hover:opacity-100 opacity-0 absolute right-3 text-[10px] text-muted-foreground font-sans transition-opacity'>
							⇧⌘O
						</kbd>
					</div>
				</Button>
			</div>

			<ChatList
				chats={chats.data?.chats || []}
				className={cn('w-72 transition-[opacity,visibility]', hideIf(isCollapsed))}
			/>

			<div className={cn('mt-auto transition-[padding]', isCollapsed ? 'p-1' : 'p-2')}>
				<SidebarUserMenu isCollapsed={isCollapsed} />
			</div>
		</div>
	);
}
