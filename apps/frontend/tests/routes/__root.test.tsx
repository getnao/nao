// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import { Route } from '@/routes/__root';

const mocks = vi.hoisted(() => ({ isSessionPending: false }));

vi.mock('@tanstack/react-router', () => ({
	createRootRoute: (options: object) => ({ options }),
	Outlet: () => <LoginPage />,
	useRouterState: () => '/login',
}));
vi.mock('@/hooks/use-session-or-navigate-to-index-page', () => ({
	useSessionOrNavigateToIndexPage: () => ({ isPending: mocks.isSessionPending }),
}));
vi.mock('@/hooks/use-agent', () => ({ useDisposeInactiveAgents: vi.fn() }));
vi.mock('@/hooks/use-server-running-chats', () => ({ useServerRunningChats: vi.fn() }));
vi.mock('@/hooks/use-identify-posthog', () => ({ useIdentifyPostHog: vi.fn() }));
vi.mock('@/hooks/useNavigateToResetPasswordPageIfNeeded', () => ({
	useNavigateToResetPasswordPageIfNeeded: () => false,
}));
vi.mock('@/components/brand-color', () => ({ BrandColor: () => null }));
vi.mock('@/components/branding-head', () => ({ BrandingHead: () => null }));
vi.mock('@/components/modify-password', () => ({ ModifyPassword: () => null }));
vi.mock('@/components/two-factor-gate', () => ({ TwoFactorGate: ({ children }: { children: ReactNode }) => children }));

function LoginPage() {
	const [step, setStep] = useState('Password');
	return (
		<button
			onClick={() => {
				setStep('Two-factor challenge');
			}}
		>
			{step}
		</button>
	);
}

function renderRoot() {
	const Root = Route.options.component as () => ReactNode;
	const root = render(<Root />);
	return {
		setSessionPending: (isPending: boolean) => {
			mocks.isSessionPending = isPending;
			root.rerender(<Root />);
		},
	};
}

beforeEach(() => {
	mocks.isSessionPending = false;
});

afterEach(() => {
	cleanup();
});

it('does not mount the page before the session has loaded', () => {
	mocks.isSessionPending = true;

	renderRoot();

	expect(screen.queryByRole('button')).toBeNull();
});

it('hides the page while a signed-out session refetches, and keeps the step it was on', () => {
	const root = renderRoot();
	fireEvent.click(screen.getByRole('button', { name: 'Password' }));

	root.setSessionPending(true);
	expect(screen.getByText('Two-factor challenge').closest('.hidden')).not.toBeNull();

	root.setSessionPending(false);
	expect(screen.getByText('Two-factor challenge').closest('.hidden')).toBeNull();
});
