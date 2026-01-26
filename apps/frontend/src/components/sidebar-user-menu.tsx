import { Link } from '@tanstack/react-router';
import { Avatar } from './ui/avatar';

import { cn, hideIf } from '@/lib/utils';
import { useSession } from '@/lib/auth-client';

interface SidebarUserMenuProps {
	isCollapsed: boolean;
}

export function SidebarUserMenu({ isCollapsed }: SidebarUserMenuProps) {
	const { data: session } = useSession();
	const username = session?.user?.name;
	const email = session?.user?.email;

	return (
		<Link
			to='/user'
			inactiveProps={{
				className: cn('text-foreground hover:bg-sidebar-accent'),
			}}
			activeProps={{
				className: cn('text-foreground bg-sidebar-accent'),
			}}
			className={cn(
				'flex items-center justify-between border-sidebar-border cursor-pointer rounded-lg',
				'hover:bg-sidebar-accent transition-[background-color,padding]',
				isCollapsed ? 'p-1.5' : 'p-3 py-2',
			)}
		>
			<div className='flex items-center gap-2'>
				{username && <Avatar username={username} />}

				<span
					className={cn(
						'flex flex-col justify-center text-left transition-[opacity,visibility] h-8',
						hideIf(isCollapsed),
					)}
				>
					<span className='text-sm font-medium'>{username}</span>
					<span className='text-xs text-muted-foreground'>{email}</span>
				</span>
			</div>
		</Link>
	);
}
