import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ModifyPassword } from '../components/modify-password';
import { useDisposeInactiveAgents } from '@/hooks/use-agent';
import { useSessionOrNavigateToLoginPage } from '@/hooks/useSessionOrNavigateToLoginPage';
import { useNavigateToResetPasswordPageIfNeeded } from '@/hooks/useNavigateToResetPasswordPageIfNeeded';
import { useIdentifyPostHog } from '@/hooks/use-identify-posthog';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	const session = useSessionOrNavigateToLoginPage();
	useDisposeInactiveAgents();
	useIdentifyPostHog();

	if (useNavigateToResetPasswordPageIfNeeded()) {
		return <ModifyPassword />;
	}

	if (session.isPending) {
		return null;
	}

	return (
		<div className='flex h-screen'>
			<Outlet />
		</div>
	);
}
