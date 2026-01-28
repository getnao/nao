import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { useSession } from '@/lib/auth-client';
import { useGetSigninLocation } from '@/hooks/useGetSigninLocation';

export const useSessionOrNavigateToLoginPage = () => {
	const navigate = useNavigate();
	const session = useSession();

	const navigation = useGetSigninLocation();

	useEffect(() => {
		if (!session.isPending && !session.data) {
			navigate({ to: navigation });
		}
	}, [session.isPending, session.data, navigate, navigation]);

	return session;
};
