import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useAuthRoute(): string {
	const hasUsers = useQuery(trpc.user.hasUsers.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());

	const isCloud = config.data?.naoMode === 'cloud';
	const isUserSignupEnabled = config.data?.enableUserSignup === true;
	const hasExistingUsers = hasUsers.data ?? true;

	if (isUserSignupEnabled && (isCloud || !hasExistingUsers)) {
		return '/signup';
	}
	return '/login';
}
