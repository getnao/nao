import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

const LAST_APP_LOCATION_KEY = 'nao:last-app-location';
const DEFAULT_APP_LOCATION = '/';

/** Remembers the last page visited outside of settings, so "Back to app" can return to it. */
export function useTrackLastAppLocation() {
	const location = useRouterState({ select: (state) => state.location });

	useEffect(() => {
		if (!isSettingsPath(location.pathname)) {
			sessionStorage.setItem(LAST_APP_LOCATION_KEY, location.href);
		}
	}, [location.href, location.pathname]);
}

export function useBackToApp() {
	const navigate = useNavigate();
	const href = getLastAppLocation();

	const goBack = useCallback(() => {
		navigate({ href });
	}, [navigate, href]);

	return { href, goBack };
}

function getLastAppLocation(): string {
	return sessionStorage.getItem(LAST_APP_LOCATION_KEY) ?? DEFAULT_APP_LOCATION;
}

function isSettingsPath(pathname: string): boolean {
	return pathname === '/settings' || pathname.startsWith('/settings/');
}
