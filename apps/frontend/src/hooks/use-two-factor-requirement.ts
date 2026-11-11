import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

const MIN_DEADLINE_CHECK_DELAY_MS = 5 * 1000;
const MAX_DEADLINE_CHECK_DELAY_MS = 60 * 60 * 1000;

interface Requirement {
	deadline: Date;
	isOverdue: boolean;
}

/** Set while an organization requires two-factor authentication and the user has not set it up yet. */
export function useTwoFactorRequirement() {
	const session = useSession();
	const userId = session.data?.user.id;
	useForgetStatusOnSignOut(userId);
	const status = useQuery(
		trpc.twoFactor.getStatus.queryOptions(undefined, {
			enabled: !!userId,
			refetchInterval: (query) => getDelayUntilDeadline(query.state.data?.requirement),
			refetchIntervalInBackground: true,
		}),
	);
	return { userId, status: status.data, requirement: status.data?.requirement ?? null };
}

/** The next user signing in, for example after a session expired, must not see the previous user's status. */
function useForgetStatusOnSignOut(userId: string | undefined) {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!userId) {
			queryClient.removeQueries({ queryKey: trpc.twoFactor.getStatus.queryKey() });
		}
	}, [queryClient, userId]);
}

/** Checks again when the grace period ends, so an open app switches to the setup screen on time. */
function getDelayUntilDeadline(requirement: Requirement | null | undefined): number | false {
	if (!requirement || requirement.isOverdue) {
		return false;
	}
	const delay = requirement.deadline.getTime() - Date.now();
	return Math.min(Math.max(delay, MIN_DEADLINE_CHECK_DELAY_MS), MAX_DEADLINE_CHECK_DELAY_MS);
}
