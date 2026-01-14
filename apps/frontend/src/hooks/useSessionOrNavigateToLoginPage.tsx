import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSession } from '@/lib/auth-client';

export const useSessionOrNavigateToLoginPage = () => {
	const navigate = useNavigate();
	const session = useSession();

	useEffect(() => {
		if (!session.isPending && !session.data) {
			navigate({ to: '/login' });
		}
	}, [session.isPending, session.data, navigate]);

	return session;
};
