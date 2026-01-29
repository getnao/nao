import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useDisposeInactiveAgents } from '@/hooks/use-agent';
import { useSessionOrNavigateToLoginPage } from '@/hooks/useSessionOrNavigateToLoginPage';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	const session = useSessionOrNavigateToLoginPage();
	useDisposeInactiveAgents();

	if (session.isPending) {
		return null;
	}

	return (
		<div className='flex h-screen'>
			<Outlet />
		</div>
	);
}
