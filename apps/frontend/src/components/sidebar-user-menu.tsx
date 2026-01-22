import { Settings } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from './ui/button';
import { Avatar } from './ui/avatar';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth-client';

interface SidebarUserMenuProps extends ComponentProps<'div'> {
	isCollapsed: boolean;
}

export function SidebarUserMenu({ isCollapsed, className, ...props }: SidebarUserMenuProps) {
	const navigate = useNavigate();
	const { data: session } = useSession();
	const username = session?.user?.name;
	const email = session?.user?.email;

	const handleNavigateToUser = () => {
		navigate({ to: '/user' });
	};

	return (
		<div
			className={cn(
				'flex items-center justify-between p-3 border-t border-sidebar-border cursor-pointer',
				'hover:bg-sidebar-accent transition-colors',
				className,
			)}
			onClick={handleNavigateToUser}
			{...props}
		>
			<div className='flex items-center gap-2'>
				{username && <Avatar username={username} />}
				{!isCollapsed && (
					<span className='flex flex-col text-left'>
						<span className='text-sm font-medium'>{username}</span>
						<span className='text-xs text-muted-foreground'>{email}</span>
					</span>
				)}
			</div>
			{!isCollapsed && (
				<div className='flex items-center gap-2'>
					<Button variant='ghost' size='icon-sm' onClick={handleNavigateToUser}>
						<Settings className='size-4' />
					</Button>
				</div>
			)}
		</div>
	);
}
