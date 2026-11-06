import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import { AccountExists } from '../components/email/account-exists';
import { BudgetLimitReached } from '../components/email/budget-limit-reached';
import { ForgotPassword } from '../components/email/forgot-password';
import { NotificationEmail } from '../components/email/notification-email';
import { ResetPassword } from '../components/email/reset-password';
import { SharedItemEmail } from '../components/email/shared-item-email';
import { TrialStarted } from '../components/email/trial-started';
import { UserAddedToProject } from '../components/email/user-added-to-project';
import { VerifyEmail } from '../components/email/verify-email';
import { Welcome } from '../components/email/welcome';
import { env } from '../env';
import { CLOUD_BILLING_TRIAL_DAYS } from '../types/billing';
import type { CreatedEmail, EmailAttachment } from '../types/email';
import { type EmailBranding, resolveEmailBranding } from './email-branding';

const DOCS_URL = 'https://docs.getnao.io';
const SLACK_URL = 'https://join.slack.com/t/naolabs/shared_invite/zt-4080jlm79-nm52x5nZhG2N1ben8zwpiQ';

export async function buildWelcomeEmail(user: { name: string }): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`Welcome to ${branding.appName} Cloud`,
		Welcome({
			userName: user.name,
			appUrl: env.BETTER_AUTH_URL,
			docsUrl: DOCS_URL,
			slackUrl: SLACK_URL,
			branding,
		}),
		branding,
	);
}

export async function buildTrialStartedEmail(
	user: { name: string },
	creditAmountMicroUsd: number,
	trialEndsAt: Date,
	userJoinCreditAmountMicroUsd?: number,
): Promise<CreatedEmail> {
	const branding = await resolveEmailBranding();
	return createEmail(
		`Your ${branding.appName} Cloud trial and credits are ready`,
		TrialStarted({
			userName: user.name,
			appUrl: env.BETTER_AUTH_URL,
			docsUrl: DOCS_URL,
			slackUrl: SLACK_URL,
			creditAmount: formatCreditAmount(creditAmountMicroUsd),
			userJoinCreditAmount:
				userJoinCreditAmountMicroUsd === undefined
					? undefined
					: formatCreditAmount(userJoinCreditAmountMicroUsd),
			trialDays: CLOUD_BILLING_TRIAL_DAYS,
			trialEndDate: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(trialEndsAt),
			branding,
		}),
		branding,
	);
}

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

function formatCreditAmount(amountMicroUsd: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: amountMicroUsd % 1_000_000 === 0 ? 0 : 2,
		maximumFractionDigits: 2,
	}).format(amountMicroUsd / 1_000_000);
}
