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
	const isCloud = config.data?.naoMode === 'cloud';

	useEffect(() => {
		if (session.isPending) {
			return;
		}

		const canStayUnauthenticated = AUTH_ROUTES.includes(pathname) || (pathname === '/signup' && isCloud);

		if (!session.data && !canStayUnauthenticated) {
			navigate({ to: navigation });
		}

		if (session.data && (AUTH_ROUTES.includes(pathname) || pathname === '/signup')) {
			navigate({ to: '/' });
		}
	}, [session.isPending, session.data, navigate, navigation, pathname, isCloud]);

	return session;
};
