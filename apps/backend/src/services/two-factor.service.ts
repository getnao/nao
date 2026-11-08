import * as accountQueries from '../queries/account.queries';
import * as twoFactorQueries from '../queries/two-factor.queries';
import {
	DEFAULT_TWO_FACTOR_METHODS,
	TWO_FACTOR_METHODS,
	type TwoFactorMethod,
	type TwoFactorRequirement,
	type TwoFactorStatus,
} from '../types/two-factor';
import { emailService } from './email';
import { getTwoFactorDeadline } from './two-factor-requirement.service';

export const TWO_FACTOR_SETUP_REQUIRED_MESSAGE =
	'Your organization requires two-factor authentication. Set it up to continue.';

/** A user in several organizations may only use the methods every one of them allows. */
export async function getAllowedTwoFactorMethods(userId: string): Promise<TwoFactorMethod[]> {
	const policies = await twoFactorQueries.listUserOrganizationsTwoFactorMethods(userId);
	const allowed = policies.length ? intersectPolicies(policies) : DEFAULT_TWO_FACTOR_METHODS;
	return allowed.filter(isMethodAvailable);
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
	const [enrollment, account, allowedMethods, deadline] = await Promise.all([
		twoFactorQueries.getTwoFactorEnrollment(userId),
		accountQueries.getAccountById(userId),
		getAllowedTwoFactorMethods(userId),
		getTwoFactorDeadline(userId),
	]);
	const enabled = !!enrollment?.enabled;
	const hasPassword = !!account?.password;
	const canSetUp = hasPassword && !enabled && allowedMethods.length > 0;
	return {
		enabled,
		method: enabled ? resolveEnrolledMethod(enrollment) : null,
		hasPassword,
		allowedMethods,
		required: !!deadline,
		requirement: deadline && canSetUp ? buildRequirement(deadline) : null,
	};
}

/**
 * Most users are never overdue, so the full status is only loaded once a deadline has passed.
 * Users who cannot set up any allowed method are never blocked.
 */
export async function isTwoFactorSetupOverdue(userId: string): Promise<boolean> {
	const deadline = await getTwoFactorDeadline(userId);
	if (!deadline || deadline > new Date()) {
		return false;
	}
	const status = await getTwoFactorStatus(userId);
	return status.requirement?.isOverdue === true;
}

/** The plugin marks the stored secret as verified only once an authenticator app code was confirmed. */
export function resolveEnrolledMethod(enrollment: twoFactorQueries.TwoFactorEnrollment): TwoFactorMethod {
	return enrollment.totpVerified ? 'totp' : 'email';
}

export function isTwoFactorEmailAvailable(): boolean {
	return emailService.isEnabled();
}

function buildRequirement(deadline: Date): TwoFactorRequirement {
	return { deadline, isOverdue: deadline <= new Date() };
}

function intersectPolicies(policies: TwoFactorMethod[][]): TwoFactorMethod[] {
	return TWO_FACTOR_METHODS.filter((method) => policies.every((policy) => policy.includes(method)));
}

function isMethodAvailable(method: TwoFactorMethod): boolean {
	return method !== 'email' || isTwoFactorEmailAvailable();
}
