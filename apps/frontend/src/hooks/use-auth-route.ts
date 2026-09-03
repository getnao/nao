import { useQuery } from '@tanstack/react-query';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { trpc } from '@/main';

export function useAuthRoute(): string {
	const hasUsers = useQuery(trpc.user.hasUsers.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());

	const isCloud = useIsCloud();
	const isUserSignupEnabled = config.data?.enableUserSignup === true;
	const hasExistingUsers = hasUsers.data ?? true;

	if (isUserSignupEnabled && (isCloud || !hasExistingUsers)) {
		return '/signup';
	}
	return '/login';
}
