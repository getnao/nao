import { isCloudWelcomeEmailEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import * as organizationQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import { emailService } from '../services/email';
import type { JobHandler } from '../services/scheduler.service';
import { CLOUD_WELCOME_EMAIL_JOB_NAME, type CloudWelcomeEmailJobPayload } from '../types/email';
import { buildTrialStartedEmail, buildWelcomeEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';

export { CLOUD_WELCOME_EMAIL_JOB_NAME };

export const cloudWelcomeEmailHandler: JobHandler<Record<string, unknown>> = async (payload) => {
	if (!isCloudWelcomeEmailEnabled()) {
		return;
	}
	const parsed = parsePayload(payload);
	if (parsed.kind === 'user') {
		await sendUserWelcomeEmail(parsed.userId);
		return;
	}
	await sendTrialStartedEmail(parsed.organizationId);
};

async function sendUserWelcomeEmail(userId: string): Promise<void> {
	const user = await userQueries.getUser({ id: userId });
	if (!user?.emailVerified || user.requiresPasswordReset) {
		return;
	}
	await sendEmail(user.email, await buildWelcomeEmail(user));
}

async function sendTrialStartedEmail(organizationId: string): Promise<void> {
	const [admin, grant, billing] = await Promise.all([
		organizationQueries.getEarliestOrganizationAdmin(organizationId),
		creditWalletQueries.getOrganizationSetupCreditGrant(organizationId),
		billingQueries.getOrganizationBilling(organizationId),
	]);
	if (!admin || !grant || !billing?.trialEndsAt) {
		logger.warn('Skipped cloud trial welcome email because required state is missing', {
			source: 'system',
			context: {
				organizationId,
				hasAdmin: Boolean(admin),
				hasGrant: Boolean(grant),
				hasTrial: Boolean(billing?.trialEndsAt),
			},
		});
		return;
	}
	await sendEmail(admin.email, await buildTrialStartedEmail(admin, grant.amountMicroUsd, billing.trialEndsAt));
}

async function sendEmail(to: string, email: Awaited<ReturnType<typeof buildWelcomeEmail>>): Promise<void> {
	// ponytail: Scheduler delivery is at-least-once; add a persistent delivery receipt if duplicates become harmful.
	await emailService.sendEmail(to, email, { throwOnError: true });
}

function parsePayload(payload: Record<string, unknown>): CloudWelcomeEmailJobPayload {
	if (payload.kind === 'user' && typeof payload.userId === 'string') {
		return { kind: 'user', userId: payload.userId };
	}
	if (payload.kind === 'trial' && typeof payload.organizationId === 'string') {
		return { kind: 'trial', organizationId: payload.organizationId };
	}
	throw new Error('Cloud welcome email job has an invalid payload');
}
