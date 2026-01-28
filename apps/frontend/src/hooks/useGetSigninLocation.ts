import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useGetSigninLocation(): string {
	const userCount = useQuery(trpc.user.countAll.queryOptions());
	const navigation = userCount.data ? '/login' : '/signup';
	return navigation;
}
