import { useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { useSession } from '@/lib/auth-client';
import { useGetSigninLocation } from '@/hooks/useGetSigninLocation';

const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password'];

export const useSessionOrNavigateToLoginPage = () => {
	const navigate = useNavigate();
	const session = useSession();
	const navigation = useGetSigninLocation();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		if (!session.isPending && !session.data && !PUBLIC_ROUTES.includes(pathname)) {
			navigate({ to: navigation });
		}
	}, [session.isPending, session.data, navigate, navigation, pathname]);

	return session;
};
