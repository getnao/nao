import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimReminder: vi.fn(),
	releaseReminder: vi.fn(),
	getOrganization: vi.fn(),
	listAdmins: vi.fn(),
	listDueReminders: vi.fn(),
	listMappedOrganizations: vi.fn(),
	reconcileCustomer: vi.fn(),
	sendEmail: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	claimTrialReminder: mocks.claimReminder,
	releaseTrialReminder: mocks.releaseReminder,
	listOrganizationsDueTrialReminder: mocks.listDueReminders,
	listOrganizationsWithStripeCustomers: mocks.listMappedOrganizations,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrganizationById: mocks.getOrganization,
	listOrgMembersWithUsers: mocks.listAdmins,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
}));

vi.mock('../src/services/email', () => ({
	emailService: {
		isEnabled: () => true,
		sendEmail: mocks.sendEmail,
	},
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
	serializeError: (error: unknown) => ({ error: String(error) }),
}));

import { runCloudBillingLifecycle, sendCloudTrialReminder } from '../src/services/billing-lifecycle.service';

describe('cloud billing lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listMappedOrganizations.mockResolvedValue([]);
		mocks.listDueReminders.mockResolvedValue([]);
		mocks.claimReminder.mockResolvedValue(true);
		mocks.releaseReminder.mockResolvedValue(undefined);
		mocks.sendEmail.mockResolvedValue(true);
	});

	it('reconciles every mapped organization without aborting after one failure', async () => {
		mocks.listMappedOrganizations.mockResolvedValue([
			{ id: 'org-one', stripeCustomerId: 'cus_one' },
			{ id: 'org-two', stripeCustomerId: 'cus_two' },
		]);
		mocks.reconcileCustomer.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({
			applied: true,
			ignored: false,
			stripeSubscriptionId: 'sub_two',
		});

		await expect(runCloudBillingLifecycle(new Date('2026-09-24T00:00:00.000Z'))).resolves.toBeUndefined();
		expect(mocks.reconcileCustomer).toHaveBeenCalledTimes(2);
	});

	it('limits concurrent Stripe reconciliation', async () => {
		let active = 0;
		let maxActive = 0;
		mocks.listMappedOrganizations.mockResolvedValue(
			Array.from({ length: 12 }, (_, index) => ({
				id: `org-${index}`,
				stripeCustomerId: `cus_${index}`,
			})),
		);
		mocks.reconcileCustomer.mockImplementation(async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active -= 1;
			return { applied: true, ignored: false };
		});

		await runCloudBillingLifecycle(new Date('2026-09-24T00:00:00.000Z'));

		expect(mocks.reconcileCustomer).toHaveBeenCalledTimes(12);
		expect(maxActive).toBe(5);
	});

	it('claims one reminder and emails active organization admins', async () => {
		const now = new Date('2026-09-24T00:00:00.000Z');
		const organization = {
			id: 'org-id',
			name: 'Acme',
			billingStatus: 'trialing',
			trialEndsAt: new Date('2026-09-27T00:00:00.000Z'),
			trialReminderClaimedAt: null,
		};
		mocks.getOrganization.mockResolvedValue(organization);
		mocks.listAdmins.mockResolvedValue([
			{ email: 'admin@example.com', name: 'Admin', role: 'admin', status: 'active' },
			{ email: 'member@example.com', name: 'Member', role: 'member', status: 'active' },
		]);

		await sendCloudTrialReminder('org-id', now);

		expect(mocks.claimReminder).toHaveBeenCalledWith('org-id', organization.trialEndsAt, now);
		expect(mocks.sendEmail).toHaveBeenCalledOnce();
		expect(mocks.sendEmail).toHaveBeenCalledWith(
			'admin@example.com',
			expect.objectContaining({ subject: 'Your nao Cloud trial ends soon' }),
		);
		expect(mocks.releaseReminder).not.toHaveBeenCalled();
	});

	it('releases the reminder when every admin email fails', async () => {
		const now = new Date('2026-09-24T00:00:00.000Z');
		const trialEndsAt = new Date('2026-09-27T00:00:00.000Z');
		mocks.getOrganization.mockResolvedValue({
			id: 'org-id',
			name: 'Acme',
			billingStatus: 'trialing',
			trialEndsAt,
			trialReminderClaimedAt: null,
		});
		mocks.listAdmins.mockResolvedValue([
			{ email: 'admin@example.com', name: 'Admin', role: 'admin', status: 'active' },
		]);
		mocks.sendEmail.mockResolvedValue(false);

		await sendCloudTrialReminder('org-id', now);

		expect(mocks.releaseReminder).toHaveBeenCalledWith('org-id', trialEndsAt, now);
	});

	it('keeps the reminder claim when one admin email is delivered', async () => {
		mocks.getOrganization.mockResolvedValue({
			id: 'org-id',
			name: 'Acme',
			billingStatus: 'trialing',
			trialEndsAt: new Date('2026-09-27T00:00:00.000Z'),
			trialReminderClaimedAt: null,
		});
		mocks.listAdmins.mockResolvedValue([
			{ email: 'first@example.com', name: 'First', role: 'admin', status: 'active' },
			{ email: 'second@example.com', name: 'Second', role: 'admin', status: 'active' },
		]);
		mocks.sendEmail.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

		await sendCloudTrialReminder('org-id', new Date('2026-09-24T00:00:00.000Z'));

		expect(mocks.releaseReminder).not.toHaveBeenCalled();
	});

	it('does not email when another worker already claimed the reminder', async () => {
		mocks.getOrganization.mockResolvedValue({
			id: 'org-id',
			name: 'Acme',
			billingStatus: 'trialing',
			trialEndsAt: new Date('2026-09-27T00:00:00.000Z'),
			trialReminderClaimedAt: null,
		});
		mocks.listAdmins.mockResolvedValue([
			{ email: 'admin@example.com', name: 'Admin', role: 'admin', status: 'active' },
		]);
		mocks.claimReminder.mockResolvedValue(false);

		await sendCloudTrialReminder('org-id', new Date('2026-09-24T00:00:00.000Z'));

		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});
});
