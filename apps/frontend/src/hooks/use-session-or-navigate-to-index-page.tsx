import { useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/lib/auth-client';
import { useAuthRoute } from '@/hooks/use-auth-route';
import { trpc } from '@/main';

const AUTH_ROUTES = ['/login', '/forgot-password', '/reset-password'];

export const useSessionOrNavigateToIndexPage = () => {
	const navigate = useNavigate();
	const session = useSession();
	const navigation = useAuthRoute();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isUserSignupEnabled = config.data?.enableUserSignup === true;

	useEffect(() => {
		if (session.isPending || config.isPending) {
			return;
		}

		const canStayUnauthenticated =
			AUTH_ROUTES.includes(pathname) || (pathname === '/signup' && isUserSignupEnabled);

		if (!session.data && !canStayUnauthenticated) {
			if (pathname === '/signup') {
				navigate({ to: '/login', search: { error: 'Sign up is disabled.' } });
			} else {
				navigate({ to: navigation });
			}
		}

		if (session.data && (AUTH_ROUTES.includes(pathname) || pathname === '/signup')) {
			navigate({ to: '/' });
		}
	}, [session.isPending, session.data, config.isPending, navigate, navigation, pathname, isUserSignupEnabled]);

	return {
		...session,
		isPending: session.isPending || config.isPending,
	};
};
