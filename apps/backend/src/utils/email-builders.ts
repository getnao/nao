import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import { BudgetLimitReached } from '../components/email/budget-limit-reached';
import { ForgotPassword } from '../components/email/forgot-password';
import { NotificationEmail } from '../components/email/notification-email';
import { ResetPassword } from '../components/email/reset-password';
import { SharedItemEmail } from '../components/email/shared-item-email';
import { UserAddedToProject } from '../components/email/user-added-to-project';
import { env } from '../env';
import type { CreatedEmail, EmailAttachment } from '../types/email';
import { type EmailBranding, resolveEmailBranding } from './email-branding';

export async function buildSharedItemEmail(
	user: { name: string },
	sharerName: string,
	itemLabel: string,
	itemTitle: string,
	itemUrl: string,
	unsubscribeUrl?: string,
): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`${sharerName} shared "${itemTitle}" with you on ${branding.appName}`,
		SharedItemEmail({ userName: user.name, sharerName, itemLabel, itemTitle, itemUrl, unsubscribeUrl, branding }),
		branding,
	);
}

export async function buildUserAddedEmail(
	user: { name: string; email: string },
	teamName: string,
	teamLabel: 'project' | 'organization',
	temporaryPassword?: string,
	invitedBy?: string,
): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`You've been added to ${teamName} on ${branding.appName}`,
		UserAddedToProject({
			userName: user.name,
			teamName,
			teamLabel,
			loginUrl: env.BETTER_AUTH_URL,
			to: user.email,
			temporaryPassword,
			invitedBy,
			branding,
		}),
		branding,
	);
}

export async function buildForgotPasswordEmail(user: { name: string }, resetUrl: string): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`Reset your password on ${branding.appName}`,
		ForgotPassword({ userName: user.name, resetUrl, branding }),
		branding,
	);
}

export async function buildResetPasswordEmail(
	user: { name: string },
	projectName: string,
	temporaryPassword: string,
): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`Your password on the project ${projectName} has been reset on ${branding.appName}`,
		ResetPassword({ userName: user.name, temporaryPassword, loginUrl: env.BETTER_AUTH_URL, projectName, branding }),
		branding,
	);
}

export async function buildNotificationEmail(
	user: { name: string },
	title: string,
	body?: string,
	linkUrl?: string,
	ctaLabel?: string,
	attachments?: EmailAttachment[],
	unsubscribeUrl?: string,
	bodyHtml?: string,
): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`${title} — ${branding.appName}`,
		NotificationEmail({ userName: user.name, title, body, bodyHtml, linkUrl, ctaLabel, unsubscribeUrl, branding }),
		branding,
		attachments ?? [],
	);
}

export async function buildBudgetLimitReachedEmail(
	user: { name: string },
	providerLabel: string,
	limitUsd: number,
	currentSpendUsd: number,
	period: string,
	resetLabel: string,
	unsubscribeUrl?: string,
): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`Budget limit reached for ${providerLabel} on ${branding.appName}`,
		BudgetLimitReached({
			userName: user.name,
			providerLabel,
			limitUsd,
			currentSpendUsd,
			period,
			resetLabel,
			unsubscribeUrl,
			branding,
		}),
		branding,
	);
}

function createEmail(
	subject: string,
	element: ReactElement,
	branding: EmailBranding,
	extraAttachments: EmailAttachment[] = [],
): CreatedEmail {
	const html = `<!DOCTYPE html>${renderToString(element)}`;
	const attachments = [...(branding.logo ? [branding.logo] : []), ...extraAttachments];
	return attachments.length > 0 ? { subject, html, attachments } : { subject, html };
}
