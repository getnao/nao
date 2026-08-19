import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { trpc } from '@/main';

const UNREAD_POLL_INTERVAL_MS = 60 * 1000;

export function useUnreadCount() {
	return useQuery({
		...trpc.notification.unreadCount.queryOptions(),
		refetchInterval: UNREAD_POLL_INTERVAL_MS,
		refetchOnWindowFocus: true,
	});
}

export function useNotifications(enabled: boolean) {
	return useQuery({
		...trpc.notification.list.queryOptions({ limit: 30 }),
		enabled,
		staleTime: 10 * 1000,
		refetchInterval: UNREAD_POLL_INTERVAL_MS,
		refetchOnWindowFocus: true,
	});
}

export function useNotificationMutations() {
	const queryClient = useQueryClient();

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.notification.list.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.notification.unreadCount.queryKey() }),
		]);

	const markRead = useMutation(trpc.notification.markRead.mutationOptions({ onSuccess: invalidate }));
	const markAllRead = useMutation(trpc.notification.markAllRead.mutationOptions({ onSuccess: invalidate }));

	return { markRead, markAllRead };
}
