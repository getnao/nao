import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { trpc } from '@/main';

const UNREAD_POLL_INTERVAL_MS = 60 * 1000;

export function useUnreadCount(projectId: string | undefined) {
	const options = trpc.notification.unreadCount.queryOptions();
	return useQuery({
		...options,
		queryKey: [options.queryKey[0], { ...options.queryKey[1], input: projectId }],
		enabled: Boolean(projectId),
		refetchInterval: UNREAD_POLL_INTERVAL_MS,
		refetchOnWindowFocus: true,
	});
}

export function useUnreadAutomationRunCount(enabled: boolean, projectId: string | undefined) {
	const options = trpc.automation.unreadCount.queryOptions();
	return useQuery({
		...options,
		queryKey: [options.queryKey[0], { ...options.queryKey[1], input: projectId }],
		enabled: enabled && Boolean(projectId),
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
