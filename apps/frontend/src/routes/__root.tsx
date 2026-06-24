import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { BrandColor } from '../components/brand-color';
import { BrandingHead } from '../components/branding-head';
import { ModifyPassword } from '../components/modify-password';
import { Spinner } from '@/components/ui/spinner';
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
		return <RootLoadingState />;
	}

	return (
		<div className='flex h-screen'>
			<BrandingHead />
			<BrandColor />
			<Outlet />
		</div>
	);
}

function RootLoadingState() {
	return (
		<div className='flex h-screen items-center justify-center bg-background'>
			<Spinner className='size-6' />
		</div>
	);
}
