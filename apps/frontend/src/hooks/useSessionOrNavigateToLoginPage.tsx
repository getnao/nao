import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function getAuthentificationNavigation(): string {
	const userCount = useQuery(trpc.user.countAll.queryOptions());
	const navigation = userCount.data ? '/login' : '/signup';
	return navigation;
}

export const useSessionOrNavigateToLoginPage = () => {
	const navigate = useNavigate();
	const session = useSession();

	const navigation = getAuthentificationNavigation();

	useEffect(() => {
		if (!session.isPending && !session.data) {
			navigate({ to: navigation });
		}
	}, [session.isPending, session.data, navigate, navigation]);

	return session;
};
