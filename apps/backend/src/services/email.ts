import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import { renderToString } from 'react-dom/server';

import { ResetPassword } from '../components/email/reset-password';
import { SharedStory } from '../components/email/shared-story';
import { UserAddedToProject } from '../components/email/user-added-to-project';
import { env } from '../env';
import type { CreatedEmail, SendEmail } from '../types/email';
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

	public async sendEmail(params: SendEmail): Promise<void> {
		if (!this.enabled || !this.transporter) {
			return;
		}

		let email: CreatedEmail;
		if (params.type === 'resetPassword') {
			email = this._createResetPasswordEmail(params);
		} else if (params.type === 'sharedStory') {
			email = this._createSharedStoryEmail(params);
		} else {
			email = this._createUserAddedToProjectEmail(params);
		}

		try {
			await this.transporter.sendMail({
				from: env.SMTP_MAIL_FROM,
				to: params.user.email,
				subject: email.subject,
				html: email.html,
			});
		} catch (error) {
			logger.error(`Failed to send email to ${params.user.email}: ${String(error)}`, {
				source: 'system',
				context: { email: params.user.email, type: params.type },
			});
		}
	}

	private _createSharedStoryEmail({
		user,
		sharerName,
		storyTitle,
		storyUrl,
	}: Extract<SendEmail, { type: 'sharedStory' }>): CreatedEmail {
		const subject = `${sharerName} shared "${storyTitle}" with you on nao`;
		const html = renderToString(SharedStory({ userName: user.name, sharerName, storyTitle, storyUrl }));
		return { subject, html };
	}

	private _createUserAddedToProjectEmail({
		user,
		projectName,
		temporaryPassword,
	}: Extract<SendEmail, { type: 'createUser' }>): CreatedEmail {
		const loginUrl = env.BETTER_AUTH_URL || 'http://localhost:3000';
		const subject = `You've been added to ${projectName} on nao`;
		const html = renderToString(
			UserAddedToProject({ userName: user.name, projectName, loginUrl, to: user.email || '', temporaryPassword }),
		);
		return { subject, html };
	}

	private _createResetPasswordEmail({
		user,
		projectName,
		temporaryPassword,
	}: Extract<SendEmail, { type: 'resetPassword' }>): CreatedEmail {
		const subject = `Your password on the project ${projectName} has been reset on nao`;
		const loginUrl = env.BETTER_AUTH_URL || 'http://localhost:3000';
		const html = renderToString(ResetPassword({ userName: user.name, temporaryPassword, loginUrl, projectName }));
		return { subject, html };
	}
}

// Singleton instance of the email service
export const emailService = new EmailService();
