import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

import { env } from '../env';
import type { CreatedEmail } from '../types/email';
import { logger } from '../utils/logger';

class EmailService {
	private transporter: Transporter | undefined = undefined;
	private enabled: boolean = false;

	constructor() {
		this._initialize();
	}

	private _initialize() {
		const { SMTP_HOST, SMTP_PORT, SMTP_MAIL_FROM, SMTP_PASSWORD, SMTP_SSL } = env;

		if (!SMTP_HOST || !SMTP_MAIL_FROM || !SMTP_PASSWORD) {
			return;
		}

		try {
			this.transporter = nodemailer.createTransport({
				host: SMTP_HOST,
				port: Number(SMTP_PORT) || 587,
				secure: SMTP_SSL === 'true',
				auth: {
					user: SMTP_MAIL_FROM,
					pass: SMTP_PASSWORD,
				},
			});

			this.enabled = true;
		} catch (error) {
			logger.error(`Failed to initialize email transporter: ${String(error)}`, { source: 'system' });
			this.enabled = false;
		}
	}

	public isEnabled(): boolean {
		return this.enabled;
	}

	public async sendEmail(to: string, email: CreatedEmail): Promise<void> {
		if (!this.isEnabled() || !this.transporter) {
			return;
		}

		try {
			await this.transporter.sendMail({
				from: env.SMTP_MAIL_FROM,
				to,
				subject: email.subject,
				html: email.html,
			});
		} catch (error) {
			logger.error(`Failed to send email to ${to}: ${String(error)}`, { source: 'system', context: { to } });
		}
	}
}

// Singleton instance of the email service
export const emailService = new EmailService();
