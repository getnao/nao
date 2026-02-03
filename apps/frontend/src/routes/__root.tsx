import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ModifyPassword } from '../components/modify-password';
import { useDisposeInactiveAgents } from '@/hooks/use-agent';
import { useSessionOrNavigateToLoginPage } from '@/hooks/useSessionOrNavigateToLoginPage';
import { useNavigateToResetPasswordPageIfNeeded } from '@/hooks/useNavigateToResetPasswordPageIfNeeded';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	const session = useSessionOrNavigateToLoginPage();
	useDisposeInactiveAgents();

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
