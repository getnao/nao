import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import { buildCloudTrialEndingEmail } from '../utils/email-builders';
import { logger, serializeError } from '../utils/logger';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';
import { emailService } from './email';

const TRIAL_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1000;
const RECONCILIATION_CONCURRENCY = 5;

export async function runCloudBillingLifecycle(now = new Date()): Promise<void> {
	await reconcileMappedOrganizations();
	await sendDueCloudTrialReminders(now);
}

export async function sendCloudTrialReminder(organizationId: string, now = new Date()): Promise<void> {
	if (!emailService.isEnabled()) {
		return;
	}
	const organization = await organizationQueries.getOrganizationById(organizationId);
	if (
		organization?.billingStatus !== 'trialing' ||
		!organization.trialEndsAt ||
		organization.trialEndsAt.getTime() <= now.getTime() ||
		organization.trialReminderClaimedAt
	) {
		return;
	}
	const trialEndsAt = organization.trialEndsAt;

	const admins = (await organizationQueries.listOrgMembersWithUsers(organization.id)).filter(
		(member) => member.role === 'admin' && member.status === 'active',
	);
	if (admins.length === 0) {
		return;
	}
	if (!(await billingQueries.claimTrialReminder(organization.id, trialEndsAt, now))) {
		return;
	}

	const delivered = await Promise.all(
		admins.map((admin) =>
			emailService.sendEmail(admin.email, buildCloudTrialEndingEmail(admin, organization.name, trialEndsAt)),
		),
	);
	if (!delivered.some(Boolean)) {
		await billingQueries.releaseTrialReminder(organization.id, trialEndsAt, now);
	}
}

async function reconcileMappedOrganizations(): Promise<void> {
	const organizations = await billingQueries.listOrganizationsWithStripeCustomers();
	for (let index = 0; index < organizations.length; index += RECONCILIATION_CONCURRENCY) {
		await Promise.all(organizations.slice(index, index + RECONCILIATION_CONCURRENCY).map(reconcileOrganization));
	}
}

async function reconcileOrganization(
	organization: Awaited<ReturnType<typeof billingQueries.listOrganizationsWithStripeCustomers>>[number],
): Promise<void> {
	if (!organization.stripeCustomerId) {
		return;
	}
	try {
		await reconcileCloudBillingCustomer({
			stripeCustomerId: organization.stripeCustomerId,
			organizationIdHint: organization.id,
		});
	} catch (error) {
		logger.error(`Cloud billing reconciliation failed for organization ${organization.id}`, {
			source: 'system',
			context: serializeError(error),
		});
	}
}

async function sendDueCloudTrialReminders(now: Date): Promise<void> {
	const dueBefore = new Date(now.getTime() + TRIAL_REMINDER_LEAD_MS);
	const organizations = await billingQueries.listOrganizationsDueTrialReminder(now, dueBefore);
	for (const organization of organizations) {
		try {
			await sendCloudTrialReminder(organization.id, now);
		} catch (error) {
			logger.error(`Cloud trial reminder failed for organization ${organization.id}`, {
				source: 'system',
				context: serializeError(error),
			});
		}
	}
}
