import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertAccess: vi.fn(),
	freeTierEnabled: false,
	getOrganizationWithBilling: vi.fn(),
	attachCustomer: vi.fn(),
	reconcileCustomer: vi.fn(),
	createCheckout: vi.fn(),
	createCreditTopUpCheckout: vi.fn(),
	createCustomer: vi.fn(),
	createPaymentMethod: vi.fn(),
	createPortal: vi.fn(),
	createResubscribe: vi.fn(),
	getBilling: vi.fn(),
	getMember: vi.fn(),
	getSubscription: vi.fn(),
	getUpcomingInvoice: vi.fn(),
	listSeatCandidates: vi.fn(),
	listInvoices: vi.fn(),
	previewSubscriptionChange: vi.fn(),
	putMember: vi.fn(),
	reconcileCustomerUnderLock: vi.fn(),
	resumeSubscription: vi.fn(),
	setSubscriptionCancellation: vi.fn(),
	updateSubscriptionPlan: vi.fn(),
	updateSubscriptionQuantity: vi.fn(),
	getUser: vi.fn(),
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloudFreeTierEnabled: () => mocks.freeTierEnabled,
}));

vi.mock('../src/queries/user.queries', () => ({
	getUser: mocks.getUser,
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	getOrganizationBilling: mocks.getBilling,
	getOrganizationWithBilling: mocks.getOrganizationWithBilling,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
	reconcileCloudBillingCustomerUnderLock: mocks.reconcileCustomerUnderLock,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrgMember: mocks.getMember,
	listOrgSeatCandidates: mocks.listSeatCandidates,
	resolveSeatedOrgUserIds: (
		candidates: Array<{ id: string; membershipClass: string; storedReadOnly?: boolean }>,
		seatLimit: number | null,
	) =>
		candidates
			.filter((candidate) => candidate.membershipClass === 'org_admin' || candidate.storedReadOnly !== true)
			.slice(0, seatLimit === null ? undefined : seatLimit)
			.map(({ id }) => id),
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertAccess,
	isActiveTrialWithoutPaidPlan: (billing: { billingPlan?: string | null; billingStatus?: string } | null) =>
		billing?.billingPlan == null && billing?.billingStatus === 'trialing',
}));

vi.mock('../src/services/credit-top-up.service', () => ({
	createCreditTopUpCheckoutSession: mocks.createCreditTopUpCheckout,
}));

vi.mock('../src/services/membership.service', () => ({
	putOrganizationMemberUnderBillingLock: mocks.putMember,
}));

vi.mock('../src/services/stripe.service', () => ({
	CloudInitialCheckoutUnavailableError: class extends Error {},
	createCloudCheckoutSession: mocks.createCheckout,
	createCloudCustomer: mocks.createCustomer,
	createCloudPaymentMethodSession: mocks.createPaymentMethod,
	createCloudPortalSession: mocks.createPortal,
	createCloudResubscribeSession: mocks.createResubscribe,
	getCloudSubscription: mocks.getSubscription,
	getCloudUpcomingInvoice: mocks.getUpcomingInvoice,
	listCloudInvoices: mocks.listInvoices,
	previewCloudSubscriptionChange: mocks.previewSubscriptionChange,
	resumeCloudSubscription: mocks.resumeSubscription,
	setCloudSubscriptionCancellation: mocks.setSubscriptionCancellation,
	updateCloudSubscriptionPlan: mocks.updateSubscriptionPlan,
	updateCloudSubscriptionQuantity: mocks.updateSubscriptionQuantity,
}));

import {
	addCloudMemberWithSeatForAdmin,
	changeCloudPlanForAdmin,
	changeCloudSeatQuantityForAdmin,
	createCloudResubscribeForAdmin,
	createCloudTrialCheckoutForAdmin,
	createCreditTopUpCheckoutForAdmin,
	getCloudBillingOrganizationForAdmin,
	keepCloudSubscriptionForAdmin,
	previewCloudMemberSeatPurchaseForAdmin,
	previewCloudPlanChangeForAdmin,
	previewCloudSeatChangeForAdmin,
	switchCloudSubscriptionToFreeForAdmin,
} from '../src/services/billing-management.service';

const adminInput = { userId: 'user-id', organizationId: 'org-id' };

describe('billing management organization loading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.freeTierEnabled = false;
	});

	it('returns the joined organization and billing state', async () => {
		const organization = {
			id: 'org-id',
			name: 'Organization',
			billing: { orgId: 'org-id', billingStatus: 'active' },
		};
		mocks.getOrganizationWithBilling.mockResolvedValue(organization);

		await expect(getCloudBillingOrganizationForAdmin(adminInput)).resolves.toBe(organization);
		expect(mocks.getOrganizationWithBilling).toHaveBeenCalledWith('org-id');
	});

	it('rejects a missing organization', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(null);

		await expect(getCloudBillingOrganizationForAdmin(adminInput)).rejects.toMatchObject({
			codeMessage: 'NOT_FOUND',
		});
	});

	it('allows credit top-ups after Cloud entitlement expires', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue({
			id: 'org-id',
			name: 'Organization',
			billing: {
				orgId: 'org-id',
				billingStatus: 'canceled',
				stripeCustomerId: 'cus_cloud',
			},
		});
		mocks.assertAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));
		mocks.createCreditTopUpCheckout.mockResolvedValue('https://checkout.stripe.com/credits');

		await expect(
			createCreditTopUpCheckoutForAdmin({
				...adminInput,
				creditAmountCents: 2_000,
				requestId: 'request-id',
			}),
		).resolves.toBe('https://checkout.stripe.com/credits');
		expect(mocks.createCreditTopUpCheckout).toHaveBeenCalledWith({
			creditAmountCents: 2_000,
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			initiatingUserId: 'user-id',
			requestId: 'request-id',
		});
	});

	it('opens Team trial Checkout with explicit paid capacity below current occupancy', async () => {
		mocks.freeTierEnabled = true;
		mocks.getMember.mockResolvedValue({ role: 'admin' });
		mocks.getUser.mockResolvedValue({ id: 'user-id', email: 'admin@example.com' });
		mocks.getOrganizationWithBilling.mockResolvedValue({
			id: 'org-id',
			name: 'Organization',
			billing: null,
		});
		mocks.createCustomer.mockResolvedValue({ id: 'cus_cloud' });
		mocks.attachCustomer.mockResolvedValue({ stripeCustomerId: 'cus_cloud' });
		mocks.createCheckout.mockResolvedValue('https://checkout.example.com');
		mocks.listSeatCandidates.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({ id: `user-${index}` })));

		await expect(
			createCloudTrialCheckoutForAdmin({
				...adminInput,
				planKey: 'cloud_team_monthly_v1',
				seatQuantity: 4,
				currency: 'usd',
			}),
		).resolves.toBe('https://checkout.example.com');

		expect(mocks.createCheckout).toHaveBeenCalledWith({
			planKey: 'cloud_team_monthly_v1',
			quantity: 4,
			currency: 'usd',
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialDays: 14,
		});
	});

	it('requires valid explicit capacity only for Team Checkout', async () => {
		mocks.freeTierEnabled = true;
		mocks.getMember.mockResolvedValue({ role: 'admin' });

		await expect(
			createCloudTrialCheckoutForAdmin({
				...adminInput,
				planKey: 'cloud_team_monthly_v1',
				currency: 'usd',
			}),
		).rejects.toThrow('Team requires between 4 and 40 seats');
		await expect(
			createCloudTrialCheckoutForAdmin({
				...adminInput,
				planKey: 'cloud_team_monthly_v1',
				seatQuantity: 3,
				currency: 'usd',
			}),
		).rejects.toThrow('Team requires between 4 and 40 seats');
		await expect(
			createCloudTrialCheckoutForAdmin({
				...adminInput,
				planKey: 'cloud_team_monthly_v1',
				seatQuantity: 41,
				currency: 'usd',
			}),
		).rejects.toThrow('Team requires between 4 and 40 seats');
		await expect(
			createCloudTrialCheckoutForAdmin({
				...adminInput,
				planKey: 'cloud_unlimited_monthly_v1',
				seatQuantity: 4,
				currency: 'usd',
			}),
		).rejects.toThrow('Seat quantity is only available for Team');
	});

	it('reconciles a Stripe Customer before allowing initial Checkout', async () => {
		mocks.getOrganizationWithBilling
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'trialing',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
					trialEndsAt: new Date('2099-01-15T00:00:00.000Z'),
					billingAccessEndsAt: new Date('2099-01-15T00:00:00.000Z'),
				},
			})
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: 'cloud_monthly_v2',
					billingStatus: 'active',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_paid',
				},
			});

		await expect(
			createCloudTrialCheckoutForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).rejects.toThrow('already used its free trial');

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.createCheckout).not.toHaveBeenCalled();
	});

	it('reconciles a Stripe Customer before allowing recovery Checkout', async () => {
		mocks.getOrganizationWithBilling
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'canceled',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
				},
			})
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'trialing',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
					trialEndsAt: new Date('2099-01-15T00:00:00.000Z'),
					billingAccessEndsAt: new Date('2099-01-15T00:00:00.000Z'),
				},
			});

		await expect(
			createCloudResubscribeForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).rejects.toThrow('A new subscription is not available');

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.createResubscribe).not.toHaveBeenCalled();
	});

	it('opens recovery Checkout after Stripe reports an expired placeholder as canceled', async () => {
		mocks.getOrganizationWithBilling
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'trialing',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
					trialEndsAt: new Date('2020-01-15T00:00:00.000Z'),
					billingAccessEndsAt: new Date('2020-01-15T00:00:00.000Z'),
				},
			})
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'canceled',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
				},
			});
		mocks.createResubscribe.mockResolvedValue('https://checkout.example.com');

		await expect(
			createCloudResubscribeForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).resolves.toBe('https://checkout.example.com');

		expect(mocks.createResubscribe).toHaveBeenCalledWith({
			allowMissingHistory: false,
			billingInterval: 'monthly',
			currency: 'usd',
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
		});
	});
});

describe('Phase 6 billing commands', () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mocks.freeTierEnabled = false;
		mocks.getMember.mockResolvedValue({ role: 'admin' });
		mocks.getOrganizationWithBilling.mockResolvedValue(teamOrganization());
		mocks.getBilling.mockResolvedValue(teamOrganization().billing);
		mocks.getUser.mockResolvedValue({ id: 'member-id', email: 'member@example.com' });
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'active',
			currency: 'usd',
		});
		mocks.listSeatCandidates.mockResolvedValue([]);
		mocks.previewSubscriptionChange.mockResolvedValue({
			amountDue: 1_000,
			subtotal: 1_000,
			tax: 0,
			discount: 0,
			currency: 'usd',
			lines: [],
		});
		mocks.reconcileCustomerUnderLock.mockResolvedValue({ applied: true, ignored: false });
		mocks.putMember.mockResolvedValue({ userId: 'member-id', role: 'user' });
		mocks.setSubscriptionCancellation.mockResolvedValue({});
		mocks.updateSubscriptionPlan.mockResolvedValue({});
		mocks.updateSubscriptionQuantity.mockResolvedValue({});
	});

	it('rejects a tampered signed preview before calling Stripe', async () => {
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 });
		const finalCharacter = preview.previewToken.at(-1);
		const tamperedToken = `${preview.previewToken.slice(0, -1)}${finalCharacter === 'a' ? 'b' : 'a'}`;

		await expect(
			changeCloudSeatQuantityForAdmin({
				...adminInput,
				previewToken: tamperedToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toMatchObject({ codeMessage: 'CONFLICT' });

		expect(mocks.updateSubscriptionQuantity).not.toHaveBeenCalled();
	});

	it('rejects an expired preview before calling Stripe', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 });
		vi.advanceTimersByTime(5 * 60_000 + 1);

		await expect(
			changeCloudSeatQuantityForAdmin({
				...adminInput,
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toMatchObject({ codeMessage: 'CONFLICT' });

		expect(mocks.updateSubscriptionQuantity).not.toHaveBeenCalled();
	});

	it('rejects a stale billing baseline before calling Stripe', async () => {
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 });
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({ billingUpdatedAt: new Date('2027-01-02T00:00:00.000Z') }),
		);

		await expect(
			changeCloudSeatQuantityForAdmin({
				...adminInput,
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toMatchObject({ codeMessage: 'CONFLICT' });

		expect(mocks.updateSubscriptionQuantity).not.toHaveBeenCalled();
	});

	it('enforces the Team minimum before previewing with Stripe', async () => {
		await expect(previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 3 })).rejects.toMatchObject({
			codeMessage: 'BAD_REQUEST',
		});

		expect(mocks.previewSubscriptionChange).not.toHaveBeenCalled();
	});

	it('maps a Stripe 402 without reconciling a partial local change', async () => {
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 });
		mocks.updateSubscriptionQuantity.mockRejectedValueOnce({ statusCode: 402 });

		await expect(
			changeCloudSeatQuantityForAdmin({
				...adminInput,
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toMatchObject({ codeMessage: 'BAD_REQUEST' });

		expect(mocks.reconcileCustomerUnderLock).not.toHaveBeenCalled();
		expect(mocks.getBilling).not.toHaveBeenCalled();
	});

	it('reselects a paid trial plan after Free was scheduled without immediate payment', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(teamOrganization({ cancellationScheduled: true }));
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: true,
			trial_end: 1_800_000_000,
		});
		const preview = await previewCloudPlanChangeForAdmin({
			...adminInput,
			targetPlanKey: 'cloud_unlimited_monthly_v1',
		});

		await changeCloudPlanForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(mocks.updateSubscriptionPlan).toHaveBeenCalledWith(
			expect.objectContaining({
				targetPlanKey: 'cloud_unlimited_monthly_v1',
				targetQuantity: 1,
				chargeImmediately: false,
			}),
		);
	});

	it('switches to Free and keeps the paid plan through explicit cancellation updates', async () => {
		mocks.getSubscription
			.mockResolvedValueOnce({
				id: 'sub_team',
				status: 'active',
				currency: 'usd',
				cancel_at_period_end: false,
			})
			.mockResolvedValueOnce({
				id: 'sub_team',
				status: 'active',
				currency: 'usd',
				cancel_at_period_end: true,
			});

		await switchCloudSubscriptionToFreeForAdmin(adminInput);
		await keepCloudSubscriptionForAdmin(adminInput);

		expect(mocks.setSubscriptionCancellation).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ cancelAtPeriodEnd: true }),
		);
		expect(mocks.setSubscriptionCancellation).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ cancelAtPeriodEnd: false }),
		);
	});

	it('serializes concurrent billing previews for one organization', async () => {
		let active = 0;
		let maximumActive = 0;
		mocks.previewSubscriptionChange.mockImplementation(async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await Promise.resolve();
			active -= 1;
			return {
				amountDue: 1_000,
				subtotal: 1_000,
				tax: 0,
				discount: 0,
				currency: 'usd',
				lines: [],
			};
		});

		await Promise.all([
			previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 }),
			previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 6 }),
		]);

		expect(maximumActive).toBe(1);
	});

	it('keeps a purchased seat reusable when membership persistence fails', async () => {
		mocks.listSeatCandidates.mockResolvedValue(
			Array.from({ length: 4 }, (_, index) => ({
				id: `existing-${index}`,
				name: `Existing ${index}`,
				email: `existing-${index}@example.com`,
				membershipClass: 'org_member',
				orgRole: 'user',
				projectRoles: [],
				joinedAt: new Date(),
				selectedAt: null,
			})),
		);
		const preview = await previewCloudMemberSeatPurchaseForAdmin({
			...adminInput,
			memberUserId: 'member-id',
			requestedRole: 'user',
		});
		mocks.putMember.mockRejectedValueOnce(new Error('database unavailable'));

		await expect(
			addCloudMemberWithSeatForAdmin({
				...adminInput,
				memberUserId: 'member-id',
				requestedRole: 'user',
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toThrow('The seat was purchased but membership activation failed');

		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledOnce();
		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledWith(expect.objectContaining({ targetQuantity: 5 }));

		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 5,
				billingUpdatedAt: new Date('2027-01-02T00:00:00.000Z'),
			}),
		);
		const retryPreview = await previewCloudMemberSeatPurchaseForAdmin({
			...adminInput,
			memberUserId: 'member-id',
			requestedRole: 'user',
		});

		await expect(
			addCloudMemberWithSeatForAdmin({
				...adminInput,
				memberUserId: 'member-id',
				requestedRole: 'user',
				previewToken: retryPreview.previewToken,
				requestId: 'ff8511d0-8670-4bc2-9647-541db408c894',
			}),
		).resolves.toMatchObject({ userId: 'member-id', role: 'user' });

		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledOnce();
	});
});

function teamOrganization(billingOverrides: Record<string, unknown> = {}) {
	return {
		id: 'org-id',
		name: 'Organization',
		bypassBilling: false,
		billing: {
			orgId: 'org-id',
			billingPlan: 'cloud_team_monthly_v1',
			billingStatus: 'active',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_team',
			stripeSubscriptionItemId: 'si_team',
			seatQuantity: 4,
			currentPeriodEndsAt: new Date('2027-02-01T00:00:00.000Z'),
			billingUpdatedAt: new Date('2027-01-01T00:00:00.000Z'),
			cancellationScheduled: false,
			stripeSubscriptionScheduleId: null,
			...billingOverrides,
		},
	};
}
