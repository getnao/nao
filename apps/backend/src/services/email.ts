import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

import { env } from '../env';
import * as organizationQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import type { CreatedEmail } from '../types/email';
import { buildCapacityContractionEmail, buildScheduledWorkPausedEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';

class EmailService {
	private transporter: Transporter | undefined = undefined;
	private enabled: boolean = false;

	constructor() {
		this._initialize();
	}

	private _initialize() {
		const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_MAIL_FROM, SMTP_PASSWORD, SMTP_SSL } = env;

		if (!SMTP_HOST || !SMTP_MAIL_FROM || !SMTP_PASSWORD) {
			return;
		}

		try {
			this.transporter = nodemailer.createTransport({
				host: SMTP_HOST,
				port: SMTP_PORT,
				secure: SMTP_SSL,
				auth: {
					user: SMTP_USER || SMTP_MAIL_FROM,
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

	public async sendEmail(to: string, email: CreatedEmail, options: { throwOnError?: boolean } = {}): Promise<void> {
		if (!this.isEnabled() || !this.transporter) {
			return;
		}

		try {
			await this.transporter.sendMail({
				from: env.SMTP_MAIL_FROM,
				to,
				replyTo: email.replyTo,
				subject: email.subject,
				html: email.html,
				attachments: email.attachments,
			});
		} catch (error) {
			logger.error(`Failed to send email to ${to}: ${String(error)}`, { source: 'system', context: { to } });
			if (options.throwOnError) {
				throw error;
			}
		}
	}
}

// Singleton instance of the email service
export const emailService = new EmailService();

export async function sendScheduledWorkPausedEmail(input: {
	organizationId: string;
	userId: string;
	resources: Array<{ type: string; id: string | null }>;
}): Promise<void> {
	const [organization, user] = await Promise.all([
		organizationQueries.getOrganizationById(input.organizationId),
		userQueries.getUser({ id: input.userId }),
	]);
	if (!organization || !user) {
		return;
	}
	await emailService.sendEmail(
		user.email,
		await buildScheduledWorkPausedEmail(user, organization.name, input.resources),
		{ throwOnError: true },
	);
}

export async function sendCapacityContractionEmails(input: {
	organizationId: string;
	readOnlyUsers: Array<{ name: string; email: string }>;
}): Promise<void> {
	const [organization, members] = await Promise.all([
		organizationQueries.getOrganizationById(input.organizationId),
		organizationQueries.listOrgMembersWithUsers(input.organizationId),
	]);
	if (!organization) {
		return;
	}
	await Promise.all(
		members
			.filter(({ role }) => role === 'admin')
			.map(async (admin) =>
				emailService.sendEmail(
					admin.email,
					await buildCapacityContractionEmail(admin, organization.name, input.readOnlyUsers),
					{ throwOnError: true },
				),
			),
	);
}
