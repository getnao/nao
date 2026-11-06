// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailVerificationPending } from './email-verification-pending';

const sendVerificationEmail = vi.fn();

vi.mock('@/lib/auth-client', () => ({
	sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}));

describe('EmailVerificationPending', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		cleanup();
		sendVerificationEmail.mockReset();
		vi.useRealTimers();
	});

	it('waits fifteen seconds, then resends with the verification callback', async () => {
		sendVerificationEmail.mockResolvedValue({ error: null });
		render(
			<EmailVerificationPending email='user@example.com' callbackURL='/email-verified?redirect=%2Fsettings' />,
		);

		const countdownButton = screen.getByRole('button', { name: 'Resend in 15s' }) as HTMLButtonElement;
		expect(countdownButton.disabled).toBe(true);
		await finishResendCooldown();

		const resendButton = screen.getByRole('button', { name: 'Resend email' }) as HTMLButtonElement;
		expect(resendButton.disabled).toBe(false);

		await act(async () => {
			fireEvent.click(resendButton);
		});

		expect(sendVerificationEmail).toHaveBeenCalledWith({
			email: 'user@example.com',
			callbackURL: '/email-verified?redirect=%2Fsettings',
		});
		expect(screen.getByRole('status').textContent).toContain('Another email is on its way');
		expect((screen.getByRole('button', { name: 'Resend in 15s' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('turns a resend rate limit into recoverable guidance', async () => {
		sendVerificationEmail.mockResolvedValue({ error: { status: 429 } });
		render(<EmailVerificationPending email='user@example.com' callbackURL='/login' />);

		await finishResendCooldown();
		const resendButton = screen.getByRole('button', { name: 'Resend email' });
		await act(async () => {
			fireEvent.click(resendButton);
		});

		expect(screen.getByRole('alert').textContent).toContain('Wait a minute');
	});
});

async function finishResendCooldown() {
	for (let second = 0; second < 15; second += 1) {
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
	}
}
