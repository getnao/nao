import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { trpc, trpcClient } from '@/main';

function formatTimeAgo(date: Date | number | string): string {
	const now = Date.now();
	const then = date instanceof Date ? date.getTime() : typeof date === 'string' ? new Date(date).getTime() : date;
	const seconds = Math.floor((now - then) / 1000);

	if (seconds < 60) {
		return 'just now';
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	if (days < 7) {
		return `${days}d ago`;
	}
	return new Date(then).toLocaleDateString();
}

export function NotificationBell({ isCollapsed }: { isCollapsed: boolean }) {
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const queryClient = useQueryClient();

	const unreadCount = useQuery({
		...trpc.notification.unreadCount.queryOptions(),
		refetchInterval: 10000,
	});

	const notifications = useQuery({
		...trpc.notification.list.queryOptions({ limit: 20 }),
		refetchInterval: 10000,
		enabled: isOpen,
	});

	const markAllAsRead = useMutation({
		mutationFn: async () => {
			return trpcClient.notification.markAllAsRead.mutate();
		},
		onSuccess: (count) => {
			if (count > 0) {
				queryClient.invalidateQueries({ queryKey: trpc.notification.list.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.notification.unreadCount.queryKey() });
			}
		},
	});

	// Close on outside click
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [isOpen]);

	// Close on Escape key
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setIsOpen(false);
			}
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [isOpen]);

	const count = unreadCount.data ?? 0;

	return (
		<div ref={containerRef}>
			{/* Inline notification panel — expands within the sidebar */}
			{isOpen && !isCollapsed && (
				<div className='border border-border bg-popover rounded-lg shadow-sm overflow-hidden mb-1 animate-in fade-in slide-in-from-bottom-2 duration-200'>
					<div className='flex items-center justify-between px-3 py-2 border-b border-border'>
						<span className='text-sm font-semibold text-foreground'>Notifications</span>
						{count > 0 && (
							<Button
								variant='ghost'
								size='sm'
								className='h-6 px-2 text-xs text-muted-foreground hover:text-foreground'
								onClick={() => markAllAsRead.mutate()}
								disabled={markAllAsRead.isPending}
							>
								<CheckCheck className='size-3 mr-1' />
								Mark all read
							</Button>
						)}
					</div>

					<div className='overflow-y-auto max-h-52'>
						{notifications.isLoading ? (
							<div className='p-4 text-center text-sm text-muted-foreground'>Loading...</div>
						) : !notifications.data?.length ? (
							<div className='p-6 text-center text-sm text-muted-foreground'>
								<Bell className='size-6 mx-auto mb-2 opacity-30' />
								No notifications yet
							</div>
						) : (
							notifications.data.map((n) => (
								<div
									key={n.id}
									className={cn(
										'px-3 py-2 border-b border-border/50 last:border-0',
										!n.read && 'bg-primary/5',
									)}
								>
									<div className='flex items-start gap-2'>
										{!n.read && <span className='mt-1 h-2 w-2 rounded-full bg-primary shrink-0' />}
										<div className='flex-1 min-w-0'>
											<p
												className={cn(
													'text-sm truncate',
													!n.read && 'font-medium text-foreground',
												)}
											>
												{n.title}
											</p>
											{n.body && (
												<p className='text-xs text-muted-foreground line-clamp-2 mt-0.5'>
													{n.body}
												</p>
											)}
											<p className='text-[10px] text-muted-foreground/70 mt-1'>
												{formatTimeAgo(n.createdAt)}
											</p>
										</div>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			)}

			<Button
				variant='ghost'
				size={isCollapsed ? 'icon-md' : 'sm'}
				className={cn(
					'relative w-full justify-start gap-2 text-muted-foreground',
					isCollapsed && 'justify-center',
				)}
				onClick={() => setIsOpen(!isOpen)}
				aria-label='Notifications'
				id='notification-bell'
			>
				<div className='relative'>
					<Bell className='size-4' />
					{count > 0 && (
						<span className='absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white'>
							{count > 9 ? '9+' : count}
						</span>
					)}
				</div>
				{!isCollapsed && <span>Notifications</span>}
			</Button>
		</div>
	);
}
