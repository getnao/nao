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
import { emailLogoAttachment } from './email-logo';

export function buildSharedItemEmail(
	user: { name: string },
	sharerName: string,
	itemLabel: string,
	itemTitle: string,
	itemUrl: string,
	unsubscribeUrl?: string,
): CreatedEmail {
	return createEmail(
		`${sharerName} shared "${itemTitle}" with you on nao`,
		SharedItemEmail({ userName: user.name, sharerName, itemLabel, itemTitle, itemUrl, unsubscribeUrl }),
	);
}

export function buildUserAddedEmail(
	user: { name: string; email: string },
	teamName: string,
	teamLabel: 'project' | 'organization',
	temporaryPassword?: string,
	invitedBy?: string,
): CreatedEmail {
	return createEmail(
		`You've been added to ${teamName} on nao`,
		UserAddedToProject({
			userName: user.name,
			teamName,
			teamLabel,
			loginUrl: env.BETTER_AUTH_URL,
			to: user.email,
			temporaryPassword,
			invitedBy,
		}),
	);
}

export function buildForgotPasswordEmail(user: { name: string }, resetUrl: string): CreatedEmail {
	return createEmail('Reset your password on nao', ForgotPassword({ userName: user.name, resetUrl }));
}

export function buildResetPasswordEmail(
	user: { name: string },
	projectName: string,
	temporaryPassword: string,
): CreatedEmail {
	return createEmail(
		`Your password on the project ${projectName} has been reset on nao`,
		ResetPassword({ userName: user.name, temporaryPassword, loginUrl: env.BETTER_AUTH_URL, projectName }),
	);
}

export function buildNotificationEmail(
	user: { name: string },
	title: string,
	body?: string,
	linkUrl?: string,
	ctaLabel?: string,
	attachments?: EmailAttachment[],
	unsubscribeUrl?: string,
	bodyHtml?: string,
): CreatedEmail {
	return createEmail(
		`${title} — nao`,
		NotificationEmail({ userName: user.name, title, body, bodyHtml, linkUrl, ctaLabel, unsubscribeUrl }),
		attachments ?? [],
	);
}

export function buildBudgetLimitReachedEmail(
	user: { name: string },
	providerLabel: string,
	limitUsd: number,
	currentSpendUsd: number,
	period: string,
	resetLabel: string,
	unsubscribeUrl?: string,
): CreatedEmail {
	return createEmail(
		`Budget limit reached for ${providerLabel} on nao`,
		BudgetLimitReached({
			userName: user.name,
			providerLabel,
			limitUsd,
			currentSpendUsd,
			period,
			resetLabel,
			unsubscribeUrl,
		}),
	);
}

function createEmail(subject: string, element: ReactElement, extraAttachments: EmailAttachment[] = []): CreatedEmail {
	const html = `<!DOCTYPE html>${renderToString(element)}`;
	const attachments = [...(emailLogoAttachment ? [emailLogoAttachment] : []), ...extraAttachments];
	return attachments.length > 0 ? { subject, html, attachments } : { subject, html };
}
