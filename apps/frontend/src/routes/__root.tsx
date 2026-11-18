import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { BrandColor } from '../components/brand-color';
import { BrandingHead } from '../components/branding-head';
import { ModifyPassword } from '../components/modify-password';
import { TwoFactorGate } from '../components/two-factor-gate';
import { PageLoader } from '@/components/page-loader';
import { useDisposeInactiveAgents } from '@/hooks/use-agent';
import { useServerRunningChats } from '@/hooks/use-server-running-chats';
import { useSessionOrNavigateToIndexPage } from '@/hooks/use-session-or-navigate-to-index-page';
import { useNavigateToResetPasswordPageIfNeeded } from '@/hooks/useNavigateToResetPasswordPageIfNeeded';
import { useIdentifyPostHog } from '@/hooks/use-identify-posthog';
import { cn } from '@/lib/utils';

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
	const hasLoadedSession = useHasLoadedOnce(session.isPending);
	useDisposeInactiveAgents();
	useServerRunningChats(!!session.data);
	useIdentifyPostHog();

	if (useNavigateToResetPasswordPageIfNeeded()) {
		return <ModifyPassword />;
	}

	if (!hasLoadedSession) {
		return <PageLoader />;
	}

	return (
		<>
			{session.isPending && <PageLoader />}
			<div className={cn('flex h-screen', session.isPending && 'hidden')}>
				<BrandingHead />
				<BrandColor />
				<TwoFactorGate>
					<Outlet />
				</TwoFactorGate>
			</div>
		</>
	);
}

/**
 * A signed-out session is pending again on every refetch: after a sign-in, and when the tab regains focus.
 * The page stays mounted through those, or the login page would lose its two-factor challenge.
 */
function useHasLoadedOnce(isPending: boolean): boolean {
	const [hasLoaded, setHasLoaded] = useState(false);
	if (!isPending && !hasLoaded) {
		setHasLoaded(true);
	}
	return hasLoaded || !isPending;
}
