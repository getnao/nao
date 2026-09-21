import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn() }));

vi.mock('nodemailer', () => ({
	default: { createTransport },
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function setSmtpEnv(overrides: Record<string, string | undefined> = {}): void {
	mockEnv.SMTP_HOST = 'smtp.example.com';
	mockEnv.SMTP_MAIL_FROM = 'from@example.com';
	mockEnv.SMTP_PASSWORD = 'secret';
	Object.assign(mockEnv, overrides);
}

async function loadEmailService() {
	vi.resetModules();
	return import('../src/services/email');
}

describe('email.service SMTP auth user', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
		createTransport.mockReset();
		createTransport.mockReturnValue({ sendMail: vi.fn() });
	});

	it('uses SMTP_MAIL_FROM as the auth user when SMTP_USER is unset', async () => {
		setSmtpEnv();
		const { emailService } = await loadEmailService();

		expect(emailService.isEnabled()).toBe(true);
		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({ auth: { user: 'from@example.com', pass: 'secret' } }),
		);
	});

	it('uses SMTP_USER as the auth user when set', async () => {
		setSmtpEnv({ SMTP_USER: 'AKIAIOSFODNN7EXAMPLE' });
		const { emailService } = await loadEmailService();

		expect(emailService.isEnabled()).toBe(true);
		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({ auth: { user: 'AKIAIOSFODNN7EXAMPLE', pass: 'secret' } }),
		);
	});

	it('does not initialize the transporter when SMTP config is incomplete', async () => {
		mockEnv.SMTP_HOST = 'smtp.example.com';
		const { emailService } = await loadEmailService();

		expect(emailService.isEnabled()).toBe(false);
		expect(createTransport).not.toHaveBeenCalled();
	});
});
