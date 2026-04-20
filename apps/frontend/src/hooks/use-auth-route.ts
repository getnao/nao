import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useAuthRoute(): string {
	const userCount = useQuery(trpc.user.countAll.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());

	const isCloud = config.data?.naoMode === 'cloud';
	const hasUsers = !!userCount.data;

	if (isCloud || !hasUsers) {
		return '/signup';
	}
	return '/login';
}
