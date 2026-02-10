import { useEffect, useRef } from 'react';
import { usePostHog } from '@/contexts/posthog.provider';
import { useSession } from '@/lib/auth-client';

/**
 * Sets the PostHog session id to the user id when they are logged in, otherwise posthog uses a persisted id in the local storage.
 */
export const useIdentifyPostHog = () => {
	const session = useSession();
	const posthog = usePostHog();
	const wasConnectedRef = useRef(false);

	useEffect(() => {
		if (!posthog || session.isPending) {
			return;
		}

		const user = session.data?.user;
		if (user) {
			wasConnectedRef.current = true;
			posthog.identify(user.id, {
				email_domain: user.email.split('@').at(1),
				name: user.name,
			});
		} else if (wasConnectedRef.current) {
			wasConnectedRef.current = false;
			posthog.reset();
		}
	}, [session.data?.user, session.isPending, posthog]);
};
