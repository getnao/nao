// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TrialStartedDialogController } from './trial-started-dialog';
import type { MouseEventHandler, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	grant: { id: 'setup-grant-id', amountMicroUsd: 20_000_000 } as {
		id: string;
		amountMicroUsd: number;
	} | null,
	isOrgAdmin: true,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: ({ enabled }: { enabled?: boolean }) => ({
		data: enabled === false ? undefined : mocks.grant,
	}),
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, onClick }: { children: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement> }) => (
		<button type='button' onClick={onClick}>
			{children}
		</button>
	),
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ isOrgAdmin: mocks.isOrgAdmin }),
}));

vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { name: 'Ada Lovelace' } } }),
}));

vi.mock('@/main', () => ({
	trpc: {
		account: {
			getOrganizationSetupCreditGrant: {
				queryOptions: () => ({ queryKey: ['organization-setup-credit-grant'] }),
			},
		},
	},
}));

beforeEach(() => {
	mocks.grant = { id: 'setup-grant-id', amountMicroUsd: 20_000_000 };
	mocks.isOrgAdmin = true;
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	vi.stubGlobal('matchMedia', () => ({ matches: true }));
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

it('shows setup credits to an admin once per browser', () => {
	const view = render(<TrialStartedDialogController />);

	expect(screen.getByRole('dialog')).toBeTruthy();
	expect(screen.getByText('You’re in, Ada')).toBeTruthy();
	expect(screen.getByText('$20')).toBeTruthy();

	fireEvent.click(screen.getByRole('button', { name: 'Ask your first question' }));
	expect(screen.queryByRole('dialog')).toBeNull();

	view.unmount();
	render(<TrialStartedDialogController />);
	expect(screen.queryByRole('dialog')).toBeNull();
});

it('counts setup credits up when motion is allowed', () => {
	const animationFrames: FrameRequestCallback[] = [];
	vi.stubGlobal('matchMedia', () => ({ matches: false }));
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		animationFrames.push(callback);
		return animationFrames.length;
	});

	render(<TrialStartedDialogController />);

	expect(screen.getByText('$0')).toBeTruthy();
	act(() => animationFrames[0](performance.now() + 900));
	expect(screen.getByText('$20')).toBeTruthy();
});

it('does not show setup credits to non-admins', () => {
	mocks.isOrgAdmin = false;

	render(<TrialStartedDialogController />);

	expect(screen.queryByRole('dialog')).toBeNull();
});

it('loads setup credits without waiting for a project role', () => {
	render(<TrialStartedDialogController />);
	expect(screen.getByRole('dialog')).toBeTruthy();
});
