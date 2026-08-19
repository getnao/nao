import { renderToString } from 'react-dom/server';

import { BudgetLimitReached } from '../components/email/budget-limit-reached';
import { ForgotPassword } from '../components/email/forgot-password';
import { NotificationEmail } from '../components/email/notification-email';
import { ResetPassword } from '../components/email/reset-password';
import { SharedItemEmail } from '../components/email/shared-item-email';
import { UserAddedToProject } from '../components/email/user-added-to-project';
import { env } from '../env';
import type { CreatedEmail, EmailAttachment } from '../types/email';

export function buildSharedItemEmail(
	user: { name: string },
	sharerName: string,
	itemLabel: string,
	itemTitle: string,
	itemUrl: string,
): CreatedEmail {
	const subject = `${sharerName} shared "${itemTitle}" with you on nao`;
	const html = renderToString(SharedItemEmail({ userName: user.name, sharerName, itemLabel, itemTitle, itemUrl }));
	return { subject, html };
}

export function buildUserAddedEmail(
	user: { name: string; email: string },
	teamName: string,
	teamLabel: 'project' | 'organization',
	temporaryPassword?: string,
): CreatedEmail {
	const subject = `You've been added to ${teamName} on nao`;
	const html = renderToString(
		UserAddedToProject({
			userName: user.name,
			teamName,
			teamLabel,
			loginUrl: env.BETTER_AUTH_URL,
			to: user.email,
			temporaryPassword,
		}),
	);
	return { subject, html };
}

export function buildForgotPasswordEmail(user: { name: string }, resetUrl: string): CreatedEmail {
	const subject = 'Reset your password on nao';
	const html = renderToString(ForgotPassword({ userName: user.name, resetUrl }));
	return { subject, html };
}

export function buildResetPasswordEmail(
	user: { name: string },
	projectName: string,
	temporaryPassword: string,
): CreatedEmail {
	const subject = `Your password on the project ${projectName} has been reset on nao`;
	const html = renderToString(
		ResetPassword({ userName: user.name, temporaryPassword, loginUrl: env.BETTER_AUTH_URL, projectName }),
	);
	return { subject, html };
}

export function buildNotificationEmail(
	user: { name: string },
	title: string,
	body?: string,
	linkUrl?: string,
	ctaLabel?: string,
	attachments?: EmailAttachment[],
	unsubscribeUrl?: string,
): CreatedEmail {
	const subject = `${title} — nao`;
	const html = renderToString(
		NotificationEmail({ userName: user.name, title, body, linkUrl, ctaLabel, unsubscribeUrl }),
	);
	return { subject, html, ...(attachments && attachments.length > 0 ? { attachments } : {}) };
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
	const subject = `Budget limit reached for ${providerLabel} on nao`;
	const html = renderToString(
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
	return { subject, html };
}
