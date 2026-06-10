import { Link } from '@tanstack/react-router';
import { ArrowLeft, SlidersVertical } from 'lucide-react';
import { Avatar } from './ui/avatar';
import { useSession } from '@/lib/auth-client';
import { cn, hideIf } from '@/lib/utils';

interface SidebarUserMenuProps {
	isCollapsed: boolean;
	isInSettings: boolean;
}

export function SidebarUserMenu({ isCollapsed, isInSettings }: SidebarUserMenuProps) {
	const { data: session } = useSession();
	const username = session?.user?.name;
	const email = session?.user?.email;

	return (
		<div className='flex flex-col gap-3'>
			<div
				className={cn(
					'group/user flex items-center rounded-lg border-sidebar-border',
					'hover:bg-sidebar-accent transition-[background-color,padding] duration-300',
					isCollapsed ? 'p-1.5' : 'p-2',
				)}
			>
				<Link
					to='/settings'
					inactiveProps={{ className: 'text-foreground' }}
					activeProps={{ className: 'text-foreground' }}
					className='flex-1 min-w-0 flex items-center cursor-pointer'
				>
					<div className={cn('flex items-center gap-2 min-w-0', hideIf(isCollapsed))}>
						{!isCollapsed && username && <Avatar username={username} className='shrink-0' />}
						<span
							className={cn(
								'flex flex-col justify-center text-left transition-[opacity,visibility] h-8 duration-300 min-w-0',
								hideIf(isCollapsed),
							)}
						>
							<span className='text-sm leading-4 font-medium truncate'>{username}</span>
							<span className='text-xs text-muted-foreground truncate'>{email}</span>
						</span>
					</div>
				</Link>
				<div className={cn('flex items-center gap-2', isCollapsed ? 'p-2' : 'p-0.5')}>
					{!isInSettings ? (
						<Link
							to='/settings'
							className='text-muted-foreground group-hover/user:text-foreground hover:text-foreground'
						>
							<SlidersVertical className='size-4' />
						</Link>
					) : (
						<Link to='/' className='text-muted-foreground hover:text-foreground'>
							<ArrowLeft className='size-4' />
						</Link>
					)}
				</div>
			</div>
		</div>
	);
}
