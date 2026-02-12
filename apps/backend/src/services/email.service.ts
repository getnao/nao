import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import { renderToString } from 'react-dom/server';

import { ResetPasswordEmail } from '../components/email/reset-password-email';
import { UserAddedToProjectEmail } from '../components/email/user-added-to-project-email';
import type { CreatedEmailData, EmailData, SendEmailParams } from '../types/email';

class EmailService {
	private transporter: Transporter | undefined = undefined;
	private enabled: boolean = false;

	constructor() {
		this.initialize();
	}

	private initialize() {
		const { SMTP_HOST, SMTP_PORT, SMTP_MAIL_FROM, SMTP_PASSWORD, SMTP_SSL } = process.env;

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
		} catch {
			this.enabled = false;
		}
	}

	public async safeSendEmail({ user, projectName, temporaryPassword, type }: SendEmailParams): Promise<void> {
		if (!this.enabled || !this.transporter) {
			return;
		}

		const data = {
			to: user.email,
			userName: user.name,
			projectName: projectName,
			loginUrl: process.env.REDIRECT_URL || 'http://localhost:3000',
			temporaryPassword: temporaryPassword,
		};

		const email = this.createEmail(data, type);

		try {
			await this.transporter.sendMail({
				from: process.env.SMTP_MAIL_FROM,
				to: user.email,
				subject: email.subject,
				html: email.html,
				text: email.text,
			});
		} catch (error) {
			console.error(`❌ Failed to send email to ${user.email}:`, error);
		}
	}

	private createEmail(data: EmailData, type: 'createUser' | 'resetPassword'): CreatedEmailData {
		if (type === 'resetPassword') {
			return this.createResetPasswordEmail(data);
		} else {
			return this.createUserAddedToProjectEmail(data);
		}
	}

	private createUserAddedToProjectEmail({
		to,
		userName,
		projectName,
		temporaryPassword,
		loginUrl,
	}: EmailData): CreatedEmailData {
		const isNewUser = !!temporaryPassword;

		const subject = isNewUser
			? `You've been invited to ${projectName} on nao`
			: `You've been added to ${projectName} on nao`;

		const html = renderToString(
			UserAddedToProjectEmail({
				userName,
				projectName,
				loginUrl,
				to: to || '',
				temporaryPassword,
			}),
		);

		const text = isNewUser
			? `
Welcome to nao!

Hi ${userName},

You've been invited to join the project "${projectName}" on nao.

Your login credentials:
Email: ${to || ''}
Temporary Password: ${temporaryPassword}

⚠️ Important: You will be required to change this password on your first login for security reasons.

Login here: ${loginUrl}

If you have any questions, please contact your project administrator.

---
This is an automated message from nao.
        `.trim()
			: `
New Project Access

Hi ${userName},

Great news! You've been added to the project "${projectName}" on nao.

You can now access this project using your existing nao account.

Login here: ${loginUrl}

If you have any questions about this project, please contact your project administrator.

---
This is an automated message from nao.
        `.trim();

		return { subject, html, text };
	}

	private createResetPasswordEmail({
		userName,
		projectName,
		temporaryPassword,
		loginUrl,
	}: EmailData): CreatedEmailData {
		const subject = `Your password on the project ${projectName} has been reset on nao`;

		const html = renderToString(
			ResetPasswordEmail({
				userName,
				temporaryPassword: temporaryPassword!,
				loginUrl,
				projectName,
			}),
		);

		const text = `
Password Reset - nao

Hi ${userName},

Your password on the project <strong>${projectName}</strong> has been reset by a project administrator.

Your new temporary password: ${temporaryPassword}

⚠️ Important: You will be required to change this password on your next login for security reasons.

Login here: ${loginUrl}

If you did not request this password reset, please contact your project administrator immediately.

---
This is an automated message from nao.
        `.trim();

		return { subject, html, text };
	}
}

// Singleton instance of the email service
export const emailService = new EmailService();
