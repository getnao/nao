import * as accountQueries from '../queries/account.queries';
import * as twoFactorQueries from '../queries/two-factor.queries';
import {
	DEFAULT_TWO_FACTOR_METHODS,
	TWO_FACTOR_METHODS,
	type TwoFactorMethod,
	type TwoFactorStatus,
} from '../types/two-factor';
import { buildTwoFactorCodeEmail } from '../utils/email-builders';
import { emailService } from './email';

export const TWO_FACTOR_EMAIL_CODE_TTL_MINUTES = 5;

/** A user in several organizations may only use the methods every one of them allows. */
export async function getAllowedTwoFactorMethods(userId: string): Promise<TwoFactorMethod[]> {
	const policies = await twoFactorQueries.listUserOrganizationsTwoFactorMethods(userId);
	const allowed = policies.length ? intersectPolicies(policies) : DEFAULT_TWO_FACTOR_METHODS;
	return allowed.filter(isMethodAvailable);
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
	const [enrollment, account, allowedMethods] = await Promise.all([
		twoFactorQueries.getTwoFactorEnrollment(userId),
		accountQueries.getAccountById(userId),
		getAllowedTwoFactorMethods(userId),
	]);
	const enabled = !!enrollment?.enabled;
	return {
		enabled,
		method: enabled ? resolveEnrolledMethod(enrollment) : null,
		hasPassword: !!account?.password,
		allowedMethods,
	};
}

/** The plugin marks the stored secret as verified only once an authenticator app code was confirmed. */
export function resolveEnrolledMethod(enrollment: twoFactorQueries.TwoFactorEnrollment): TwoFactorMethod {
	return enrollment.totpVerified ? 'totp' : 'email';
}

export async function sendTwoFactorCodeEmail(user: { email: string; name: string }, code: string): Promise<void> {
	const email = await buildTwoFactorCodeEmail(user, code, TWO_FACTOR_EMAIL_CODE_TTL_MINUTES);
	await emailService.sendEmail(user.email, email, { throwOnError: true });
}

export function isTwoFactorEmailAvailable(): boolean {
	return emailService.isEnabled();
}

function intersectPolicies(policies: TwoFactorMethod[][]): TwoFactorMethod[] {
	return TWO_FACTOR_METHODS.filter((method) => policies.every((policy) => policy.includes(method)));
}

function isMethodAvailable(method: TwoFactorMethod): boolean {
	return method !== 'email' || isTwoFactorEmailAvailable();
}
