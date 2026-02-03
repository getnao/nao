import { useSession } from '@/lib/auth-client';

export const useNavigateToResetPasswordPageIfNeeded = () => {
	const session = useSession();

	if (!session.isPending && session.data?.user?.requiresPasswordReset) {
		return true;
	}
	return false;
};
