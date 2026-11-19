// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TwoFactorGate } from '@/components/two-factor-gate';

const mocks = vi.hoisted(() => ({
	session: { user: { id: 'user-1' } } as object | null,
	status: undefined as { setupRequired: boolean; emailCodesAllowed: boolean } | undefined,
	isStatusRequested: false,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { enabled: boolean }) => {
		mocks.isStatusRequested = options.enabled;
		return { data: options.enabled ? mocks.status : undefined };
	},
	useQueryClient: () => ({ clear: vi.fn() }),
}));
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn(), useSession: () => ({ data: mocks.session }) }));
vi.mock('@/main', () => ({
	trpc: { account: { getTwoFactorStatus: { queryOptions: (_input: unknown, options: object) => options } } },
}));
vi.mock('@/components/settings/two-factor-setup-dialog', () => ({
	TwoFactorSetupDialog: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close setup</button>,
}));

function renderGate() {
	return render(
		<TwoFactorGate>
			<p>The app</p>
		</TwoFactorGate>,
	);
}

beforeEach(() => {
	mocks.session = { user: { id: 'user-1' } };
	mocks.status = { setupRequired: true, emailCodesAllowed: true };
});

afterEach(() => {
	cleanup();
});

it('lets a member with nothing to set up into the app', () => {
	mocks.status = { setupRequired: false, emailCodesAllowed: true };

	renderGate();

	expect(screen.getByText('The app')).toBeTruthy();
});

it('does not ask for the status of a visitor who is not signed in', () => {
	mocks.session = null;

	renderGate();

	expect(mocks.isStatusRequested).toBe(false);
	expect(screen.getByText('The app')).toBeTruthy();
});

it('replaces the app until the setup is closed, so the backup codes stay visible once it is on', () => {
	const gate = renderGate();
	expect(screen.queryByText('The app')).toBeNull();

	fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
	mocks.status = { setupRequired: false, emailCodesAllowed: true };
	gate.rerender(
		<TwoFactorGate>
			<p>The app</p>
		</TwoFactorGate>,
	);
	expect(screen.queryByText('The app')).toBeNull();

	fireEvent.click(screen.getByRole('button', { name: 'Close setup' }));
	expect(screen.getByText('The app')).toBeTruthy();
});
