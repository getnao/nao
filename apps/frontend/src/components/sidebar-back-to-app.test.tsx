// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarBackToApp } from './sidebar-back-to-app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { resetLastAppLocation, useTrackLastAppLocation } from '@/hooks/use-last-app-location';

const { router } = vi.hoisted(() => ({
	router: {
		location: { pathname: '/', href: '/' },
		navigate: vi.fn(),
	},
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => router.navigate,
	useRouterState: ({ select }: { select: (state: { location: typeof router.location }) => unknown }) =>
		select({ location: router.location }),
}));

describe('SidebarBackToApp', () => {
	beforeEach(() => {
		sessionStorage.clear();
		router.navigate.mockReset();
	});
	afterEach(cleanup);

	it('returns to the last page visited outside of settings', () => {
		const { rerender } = renderAt('/chats/chat-1', '/chats/chat-1?view=table');
		visit('/settings/general', '/settings/general', rerender);
		visit('/settings/memory', '/settings/memory', rerender);

		const backLink = screen.getByRole('link', { name: 'Back to app' });
		expect(backLink.getAttribute('href')).toBe('/chats/chat-1?view=table');

		fireEvent.click(backLink);

		expect(router.navigate).toHaveBeenCalledWith({ href: '/chats/chat-1?view=table' });
	});

	it('falls back to the home page when settings was opened directly', () => {
		renderAt('/settings/general', '/settings/general');

		fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));

		expect(router.navigate).toHaveBeenCalledWith({ href: '/' });
	});

	it('leaves modified clicks to the browser so the app can open in a new tab', () => {
		const { rerender } = renderAt('/stories', '/stories');
		visit('/settings/general', '/settings/general', rerender);

		const backLink = screen.getByRole('link', { name: 'Back to app' });
		backLink.addEventListener('click', (event) => event.preventDefault());
		fireEvent.click(backLink, { metaKey: true });

		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('forgets the remembered page once the project changes', () => {
		const { rerender } = renderAt('/chats/chat-1', '/chats/chat-1');
		visit('/settings/general', '/settings/general', rerender);

		resetLastAppLocation();
		visit('/settings/project', '/settings/project', rerender);

		expect(screen.getByRole('link', { name: 'Back to app' }).getAttribute('href')).toBe('/');
	});
});

function SettingsSidebar() {
	useTrackLastAppLocation();
	return <SidebarBackToApp isCollapsed={false} />;
}

function renderAt(pathname: string, href: string) {
	router.location = { pathname, href };
	return render(<SettingsSidebar />, { wrapper: TooltipProvider });
}

function visit(pathname: string, href: string, rerender: (ui: React.ReactElement) => void) {
	router.location = { pathname, href };
	rerender(<SettingsSidebar />);
}
