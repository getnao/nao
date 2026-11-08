import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

/** Set while an organization requires two-factor authentication and the user has not set it up yet. */
export function useTwoFactorRequirement() {
	const session = useSession();
	const status = useQuery(trpc.twoFactor.getStatus.queryOptions(undefined, { enabled: !!session.data }));
	return { status: status.data, requirement: status.data?.requirement ?? null };
}
