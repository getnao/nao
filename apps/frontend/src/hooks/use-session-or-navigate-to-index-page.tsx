import { useEffect } from 'react';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/lib/auth-client';
import { useAuthRoute } from '@/hooks/use-auth-route';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { trpc } from '@/main';

const AUTH_ROUTES = ['/login', '/forgot-password', '/reset-password'];

export const useSessionOrNavigateToIndexPage = () => {
	const navigate = useNavigate();
	const router = useRouter();
	const session = useSession();
	const navigation = useAuthRoute();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const searchStr = useRouterState({ select: (s) => s.location.searchStr });
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isUserSignupEnabled = config.data?.enableUserSignup === true;

	useEffect(() => {
		if (session.isPending || config.isPending) {
			return;
		}

		const canStayUnauthenticated =
			AUTH_ROUTES.includes(pathname) || (pathname === '/signup' && isUserSignupEnabled);

		if (!session.data && !canStayUnauthenticated) {
			const redirect = getSafeRedirectPath(`${pathname}${searchStr ?? ''}`) ?? undefined;
			if (pathname === '/signup') {
				navigate({ to: '/login', search: { error: 'Sign up is disabled.', redirect } });
			} else {
				navigate({ to: navigation, search: { redirect } });
			}
		}

		if (session.data && (AUTH_ROUTES.includes(pathname) || pathname === '/signup')) {
			const redirect = getSafeRedirectPath(new URLSearchParams(searchStr ?? '').get('redirect'));
			if (redirect) {
				router.history.push(redirect);
			} else {
				navigate({ to: '/' });
			}
		}
	}, [
		session.isPending,
		session.data,
		config.isPending,
		navigate,
		router,
		navigation,
		pathname,
		searchStr,
		isUserSignupEnabled,
	]);

	return {
		...session,
		isPending: session.isPending || config.isPending,
	};
};
