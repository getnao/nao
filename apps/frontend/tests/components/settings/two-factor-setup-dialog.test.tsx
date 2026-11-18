// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '../../helpers/query-client';
import { TwoFactorSetupDialog } from '@/components/settings/two-factor-setup-dialog';

const mocks = vi.hoisted(() => ({
	enable: vi.fn(),
	sendOtp: vi.fn(),
	verifyTotp: vi.fn(),
	verifyOtp: vi.fn(),
	onClose: vi.fn(),
}));

vi.mock('@/lib/auth-client', async (importOriginal) => ({
	...(await importOriginal<object>()),
	twoFactor: mocks,
}));
vi.mock('@/main', () => ({
	trpc: { account: { getTwoFactorStatus: { queryKey: () => ['two-factor-status'] } } },
}));
vi.mock('@/hooks/use-branding', () => ({ useBranding: () => ({ enabled: false, appName: null }) }));

function renderDialog(emailCodesAllowed: boolean) {
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<TwoFactorSetupDialog emailCodesAllowed={emailCodesAllowed} onClose={mocks.onClose} />
		</QueryClientProvider>,
	);
}

function confirmPassword() {
	fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'my-password' } });
	fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

async function enterCode(code: string) {
	fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: code } });
	fireEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));
}

beforeEach(() => {
	vi.clearAllMocks();
	const setup = { totpURI: 'otpauth://totp/nao:me?secret=MANUALKEY', backupCodes: ['backup-1', 'backup-2'] };
	mocks.enable.mockResolvedValue({ data: setup, error: null });
	mocks.sendOtp.mockResolvedValue({ data: { status: true }, error: null });
	mocks.verifyTotp.mockResolvedValue({ data: { status: true }, error: null });
	mocks.verifyOtp.mockResolvedValue({ data: { token: 'session' }, error: null });
});

afterEach(() => {
	cleanup();
});

it('sets up an authenticator app, then shows the backup codes until Done is clicked', async () => {
	renderDialog(false);
	expect(screen.queryByRole('group', { name: 'Two-factor method' })).toBeNull();

	confirmPassword();
	expect(await screen.findByText('MANUALKEY')).toBeTruthy();
	await enterCode(' 123456 ');

	expect(await screen.findByText('backup-2')).toBeTruthy();
	expect(mocks.enable).toHaveBeenCalledWith({ password: 'my-password', issuer: undefined });
	expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
	fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
	expect(mocks.onClose).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Done' }));
	expect(mocks.onClose).toHaveBeenCalledOnce();
});

it('sets up email codes with an emailed code when the organization allows them', async () => {
	renderDialog(true);
	fireEvent.click(screen.getByRole('button', { name: 'Email code' }));

	confirmPassword();
	await enterCode('654321');

	expect(await screen.findByText('backup-1')).toBeTruthy();
	expect(mocks.sendOtp).toHaveBeenCalledOnce();
	expect(mocks.verifyOtp).toHaveBeenCalledWith({ code: '654321' });
	expect(mocks.verifyTotp).not.toHaveBeenCalled();
});

it('stays on the dismissable password step and shows why when the password is wrong', async () => {
	mocks.enable.mockResolvedValue({ data: null, error: { message: 'Invalid password' } });
	renderDialog(false);

	confirmPassword();

	expect(await screen.findByText('Invalid password')).toBeTruthy();
	fireEvent.keyDown(screen.getByLabelText('Confirm your password'), { key: 'Escape' });
	expect(mocks.onClose).toHaveBeenCalledOnce();
});
