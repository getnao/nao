import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { BrandingHead } from '../components/branding-head';
import { ModifyPassword } from '../components/modify-password';
import { useDisposeInactiveAgents } from '@/hooks/use-agent';
import { useSessionOrNavigateToIndexPage } from '@/hooks/use-session-or-navigate-to-index-page';
import { useNavigateToResetPasswordPageIfNeeded } from '@/hooks/useNavigateToResetPasswordPageIfNeeded';
import { useIdentifyPostHog } from '@/hooks/use-identify-posthog';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	if (pathname.startsWith('/embed')) {
		return <Outlet />;
	}

	return <AuthenticatedRoot />;
}

function AuthenticatedRoot() {
	const session = useSessionOrNavigateToIndexPage();
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
			<BrandingHead />
			<Outlet />
		</div>
	);
}
