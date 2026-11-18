import type { BetterAuthPlugin } from 'better-auth';
import { twoFactor } from 'better-auth/plugins/two-factor';

import * as accountQueries from '../queries/account.queries';
import * as twoFactorQueries from '../queries/two-factor.queries';
import { buildNotificationEmail } from '../utils/email-builders';
import { DEFAULT_APP_NAME } from './branding.service';
import { emailService } from './email';

const EMAIL_CODE_TTL_MINUTES = 5;

export type TwoFactorMethod = 'totp' | 'email';

export interface TwoFactorStatus {
	enabled: boolean;
	method: TwoFactorMethod | null;
	hasPassword: boolean;
	emailCodesAllowed: boolean;
	setupRequired: boolean;
}

interface SessionUser {
	id: string;
	twoFactorEnabled?: boolean | null;
}

export function twoFactorPlugin(): BetterAuthPlugin {
	return twoFactor({
		issuer: DEFAULT_APP_NAME,
		otpOptions: {
			period: EMAIL_CODE_TTL_MINUTES,
			storeOTP: 'hashed',
			sendOTP: async ({ user, otp }) => {
				await sendEmailCode(user, otp);
			},
		},
	});
}

/**
 * Two-factor authentication only applies to password logins, so SSO-only accounts are never required to set it up.
 * Email codes need every organization of the user to allow them.
 */
export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
	const [enrollment, account, policy] = await Promise.all([
		twoFactorQueries.getTwoFactorEnrollment(userId),
		accountQueries.getAccountById(userId),
		twoFactorQueries.getUserTwoFactorPolicy(userId),
	]);
	const enabled = !!enrollment?.enabled;
	const hasPassword = !!account?.password;
	return {
		enabled,
		method: enabled ? resolveMethod(enrollment) : null,
		hasPassword,
		emailCodesAllowed: emailService.isEnabled() && policy.emailCodes,
		setupRequired: hasPassword && !enabled && policy.required,
	};
}

/** Runs on every authenticated request, so the full status is only loaded for the few users who may be blocked. */
export async function isTwoFactorSetupRequired(user: SessionUser): Promise<boolean> {
	if (user.twoFactorEnabled) {
		return false;
	}
	const policy = await twoFactorQueries.getUserTwoFactorPolicy(user.id);
	return policy.required && (await getTwoFactorStatus(user.id)).setupRequired;
}

/**
 * The plugin offers an emailed code to every account. A code that is never sent cannot be used, so sending one only
 * to accounts on email codes keeps authenticator app users from falling back to email, and members from setting up
 * a method their organization does not allow.
 */
async function sendEmailCode(user: { id: string; email: string; name: string }, code: string): Promise<void> {
	const enrollment = await twoFactorQueries.getTwoFactorEnrollment(user.id);
	const isOnEmailCodes = enrollment?.totpVerified === false;
	if (!isOnEmailCodes || !(enrollment.enabled || (await getTwoFactorStatus(user.id)).emailCodesAllowed)) {
		return;
	}
	const email = await buildNotificationEmail(
		user,
		`Your verification code is ${code}`,
		`It expires in ${EMAIL_CODE_TTL_MINUTES} minutes. If you did not ask for it, someone may know your password: change it as soon as possible.`,
	);
	await emailService.sendEmail(user.email, email, { throwOnError: true });
}

/** The plugin marks the stored secret as verified only once an authenticator app code was confirmed. */
function resolveMethod(enrollment: twoFactorQueries.TwoFactorEnrollment | null): TwoFactorMethod {
	return enrollment?.totpVerified ? 'totp' : 'email';
}
