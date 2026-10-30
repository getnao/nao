import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import { AccountExists } from '../components/email/account-exists';
import { BudgetLimitReached } from '../components/email/budget-limit-reached';
import { ForgotPassword } from '../components/email/forgot-password';
import { NotificationEmail } from '../components/email/notification-email';
import { ResetPassword } from '../components/email/reset-password';
import { SharedItemEmail } from '../components/email/shared-item-email';
import { UserAddedToProject } from '../components/email/user-added-to-project';
import { VerifyEmail } from '../components/email/verify-email';
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

export async function buildVerifyEmail(user: { name: string }, verificationUrl: string): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`Verify your email on ${branding.appName}`,
		VerifyEmail({ userName: user.name, verificationUrl, branding }),
		branding,
	);
}

export async function buildAccountExistsEmail(user: { name: string }, loginUrl: string): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`You already have an account on ${branding.appName}`,
		AccountExists({ userName: user.name, loginUrl, branding }),
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

export async function buildScheduledWorkPausedEmail(
	user: { name: string },
	organizationName: string,
	resources: Array<{ type: string; id: string | null }>,
): Promise<CreatedEmail> {
	const bodyHtml = `<p>Your scheduled work in ${escapeEmailText(organizationName)} is paused because you currently have viewer access.</p><ul>${resources
		.map(
			(resource) =>
				`<li>${escapeEmailText(resource.type)}${resource.id ? ` (${escapeEmailText(resource.id)})` : ''}</li>`,
		)
		.join('')}</ul><p>An organization admin can restore access by adding or reallocating a seat.</p>`;
	return buildNotificationEmail(
		user,
		'Scheduled work paused',
		undefined,
		'/settings/organization/billing',
		'View billing and seats',
		undefined,
		undefined,
		bodyHtml,
	);
}

export async function buildCapacityContractionEmail(
	user: { name: string },
	organizationName: string,
	readOnlyUsers: Array<{ name: string; email: string }>,
): Promise<CreatedEmail> {
	const bodyHtml = `<p>${escapeEmailText(organizationName)} now has ${readOnlyUsers.length} ${readOnlyUsers.length === 1 ? 'person' : 'people'} with viewer access because capacity decreased.</p><ul>${readOnlyUsers
		.map(({ name, email }) => `<li>${escapeEmailText(name)} (${escapeEmailText(email)})</li>`)
		.join('')}</ul><p>Add seats, change the seat selection, or update memberships to restore access.</p>`;
	return buildNotificationEmail(
		user,
		'Organization capacity changed',
		undefined,
		'/settings/organization/billing',
		'Manage seats',
		undefined,
		undefined,
		bodyHtml,
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

function escapeEmailText(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
