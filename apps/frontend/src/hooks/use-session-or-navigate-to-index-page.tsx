import { useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { useSession } from '@/lib/auth-client';
import { useAuthRoute } from '@/hooks/use-auth-route';

const AUTH_ROUTES = ['/login', '/forgot-password', '/reset-password'];

export const useSessionOrNavigateToIndexPage = () => {
	const navigate = useNavigate();
	const session = useSession();
	const navigation = useAuthRoute();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		if (session.isPending) {
			return;
		}

		if (!session.data && !AUTH_ROUTES.includes(pathname)) {
			navigate({ to: navigation });
		}

		if (session.data && (AUTH_ROUTES.includes(pathname) || pathname === '/signup')) {
			navigate({ to: '/' });
		}
	}, [session.isPending, session.data, navigate, navigation, pathname]);

	return session;
};
