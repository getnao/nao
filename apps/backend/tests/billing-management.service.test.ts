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
	findPromotionCode: vi.fn(),
	getBilling: vi.fn(),
	getMember: vi.fn(),
	getProrationDate: vi.fn(),
	getSubscription: vi.fn(),
	getUpcomingInvoice: vi.fn(),
	getPlanChangeSchedule: vi.fn(),
	getPendingSubscriptionChange: vi.fn(),
	listSeatCandidates: vi.fn(),
	listSeatStates: vi.fn(),
	listInvoices: vi.fn(),
	previewSubscriptionChange: vi.fn(),
	putMember: vi.fn(),
	reconcileCustomerUnderLock: vi.fn(),
	createPlanChangeSchedule: vi.fn(),
	updatePlanChangeSchedule: vi.fn(),
	releasePlanChangeSchedule: vi.fn(),
	resumeSubscription: vi.fn(),
	setSubscriptionCancellation: vi.fn(),
	setPendingBillingChange: vi.fn(),
	setPendingFreeSeatSelection: vi.fn(),
	setSeatSelection: vi.fn(),
	syncSeatState: vi.fn(),
	attachSubscriptionSchedule: vi.fn(),
	clearPendingBillingChange: vi.fn(),
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
	attachSubscriptionSchedule: mocks.attachSubscriptionSchedule,
	clearPendingBillingChange: mocks.clearPendingBillingChange,
	getOrganizationBilling: mocks.getBilling,
	getOrganizationWithBilling: mocks.getOrganizationWithBilling,
	setPendingBillingChange: mocks.setPendingBillingChange,
	setPendingFreeSeatSelection: mocks.setPendingFreeSeatSelection,
}));

vi.mock('../src/queries/organization-seat-state.queries', () => ({
	listOrganizationSeatStates: mocks.listSeatStates,
	setOrganizationSeatSelection: mocks.setSeatSelection,
	syncOrganizationSeatState: mocks.syncSeatState,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
	reconcileCloudBillingCustomerUnderLock: mocks.reconcileCustomerUnderLock,
	releasePendingBillingChange: async (organizationId: string, scheduleId: string) => {
		await mocks.releasePlanChangeSchedule(scheduleId);
		await mocks.clearPendingBillingChange(organizationId);
	},
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrgMember: mocks.getMember,
	listOrgSeatCandidates: mocks.listSeatCandidates,
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
	resumeCloudSubscription: mocks.resumeSubscription,
}));

vi.mock('../src/services/stripe-subscription-change.service', () => ({
	createCloudPlanChangeSchedule: mocks.createPlanChangeSchedule,
	findActiveCloudPromotionCode: mocks.findPromotionCode,
	getCloudPlanChangeSchedule: mocks.getPlanChangeSchedule,
	getCloudProrationDate: mocks.getProrationDate,
	getPendingCloudSubscriptionChange: mocks.getPendingSubscriptionChange,
	previewCloudSubscriptionChange: mocks.previewSubscriptionChange,
	releaseCloudPlanChangeSchedule: mocks.releasePlanChangeSchedule,
	setCloudSubscriptionCancellation: mocks.setSubscriptionCancellation,
	updateCloudSubscriptionPlan: mocks.updateSubscriptionPlan,
	updateCloudSubscriptionQuantity: mocks.updateSubscriptionQuantity,
	updateCloudPlanChangeSchedule: mocks.updatePlanChangeSchedule,
}));

import {
	addCloudMemberWithSeatForAdmin,
	changeCloudPlanForAdmin,
	changeCloudSeatQuantityForAdmin,
	keepCloudSubscriptionForAdmin,
	previewCloudMemberSeatPurchaseForAdmin,
	previewCloudPlanChangeForAdmin,
	previewCloudSeatChangeForAdmin,
	switchCloudSubscriptionToFreeForAdmin,
} from '../src/services/billing-change.service';
import {
	createCloudResubscribeForAdmin,
	createCloudTrialCheckoutForAdmin,
	createCreditTopUpCheckoutForAdmin,
	loadCloudBillingOrganization,
} from '../src/services/billing-management.service';
import { cloudSubscriptionChangeIntentMetadata } from '../src/utils/stripe';

const adminInput = { userId: 'user-id', organizationId: 'org-id' };

describe('billing management organization loading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.freeTierEnabled = false;
		mocks.getMember.mockResolvedValue({ role: 'admin' });
	});

	it('returns the joined organization and billing state', async () => {
		const organization = {
			id: 'org-id',
			name: 'Organization',
			billing: { orgId: 'org-id', billingStatus: 'active' },
		};
		mocks.getOrganizationWithBilling.mockResolvedValue(organization);

		await expect(loadCloudBillingOrganization(adminInput.organizationId)).resolves.toBe(organization);
		expect(mocks.getOrganizationWithBilling).toHaveBeenCalledWith('org-id');
	});

	it('rejects a missing organization', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(null);

		await expect(loadCloudBillingOrganization(adminInput.organizationId)).rejects.toMatchObject({
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
		const trialEndsAt = new Date('2099-10-08T00:00:00.000Z');
		mocks.freeTierEnabled = true;
		mocks.getMember.mockResolvedValue({ role: 'admin' });
		mocks.getUser.mockResolvedValue({ id: 'user-id', email: 'admin@example.com' });
		mocks.getOrganizationWithBilling.mockResolvedValue({
			id: 'org-id',
			name: 'Organization',
			billing: {
				billingStatus: 'trialing',
				stripeSubscriptionId: null,
				trialEndsAt,
			},
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
			trialEnd: trialEndsAt,
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

		expect(mocks.reconcileCustomerUnderLock).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.createCheckout).not.toHaveBeenCalled();
	});

	it('requires project setup to start the trial before initial Checkout', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue({
			id: 'org-id',
			name: 'Organization',
			billing: null,
		});

		await expect(
			createCloudTrialCheckoutForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).rejects.toThrow('Finish setting up your first project');

		expect(mocks.createCustomer).not.toHaveBeenCalled();
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

		expect(mocks.reconcileCustomerUnderLock).toHaveBeenCalledWith({
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

describe('billing change commands', () => {
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
		mocks.listSeatStates.mockResolvedValue([]);
		mocks.findPromotionCode.mockResolvedValue(null);
		mocks.getProrationDate.mockResolvedValue(new Date());
		mocks.getPendingSubscriptionChange.mockResolvedValue(null);
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
		mocks.updateSubscriptionPlan.mockResolvedValue({ status: 'completed', subscription: {} });
		mocks.updateSubscriptionQuantity.mockResolvedValue({ status: 'completed', subscription: {} });
		mocks.createPlanChangeSchedule.mockResolvedValue({ id: 'sub_sched_team' });
		mocks.getPlanChangeSchedule.mockResolvedValue({ id: 'sub_sched_team', phases: [] });
		mocks.updatePlanChangeSchedule.mockResolvedValue({});
		mocks.releasePlanChangeSchedule.mockResolvedValue({});
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

	it('previews and applies a promotion code to an immediate seat increase', async () => {
		mocks.findPromotionCode.mockResolvedValue({
			id: 'promo_team',
			discountedPlanAmount: 20_000,
			duration: 'forever',
		});
		const preview = await previewCloudSeatChangeForAdmin({
			...adminInput,
			targetQuantity: 5,
			promotionCode: ' TEAM20 ',
		});

		await changeCloudSeatQuantityForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(mocks.findPromotionCode).toHaveBeenCalledWith({
			code: 'TEAM20',
			stripeCustomerId: 'cus_cloud',
			targetPlanKey: 'cloud_team_monthly_v1',
			targetQuantity: 5,
			currency: 'usd',
		});
		expect(preview.promotionCodeDiscount).toEqual({ amount: 20_000, duration: 'forever' });
		expect(mocks.previewSubscriptionChange).toHaveBeenCalledWith(
			expect.objectContaining({ promotionCodeId: 'promo_team' }),
		);
		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledWith(
			expect.objectContaining({ promotionCodeId: 'promo_team' }),
		);
	});

	it('schedules a seat decrease for the next renewal', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(teamOrganization({ seatQuantity: 6 }));
		mocks.findPromotionCode.mockResolvedValue({
			id: 'promo_renewal',
			discountedPlanAmount: 16_000,
			duration: 'once',
		});
		const preview = await previewCloudSeatChangeForAdmin({
			...adminInput,
			targetQuantity: 4,
			promotionCode: 'RENEWAL',
		});

		expect(preview).toMatchObject({
			effective: 'period_end',
			effectiveAt: new Date('2027-02-01T00:00:00.000Z'),
			targetSeatQuantity: 4,
		});

		await changeCloudSeatQuantityForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(mocks.updateSubscriptionQuantity).not.toHaveBeenCalled();
		expect(mocks.setPendingBillingChange).toHaveBeenCalledWith('org-id', 'cloud_team_monthly_v1', 4);
		expect(mocks.createPlanChangeSchedule).toHaveBeenCalledOnce();
		expect(mocks.updatePlanChangeSchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				targetPlanKey: 'cloud_team_monthly_v1',
				targetQuantity: 4,
				promotionCodeId: 'promo_renewal',
			}),
		);
	});

	it('replaces an existing scheduled seat decrease', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 6,
				stripeSubscriptionScheduleId: 'sub_sched_team',
				pendingBillingPlan: 'cloud_team_monthly_v1',
				pendingSeatQuantity: 5,
			}),
		);
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 4 });

		await changeCloudSeatQuantityForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(mocks.createPlanChangeSchedule).not.toHaveBeenCalled();
		expect(mocks.getPlanChangeSchedule).toHaveBeenCalledWith('sub_sched_team');
		expect(mocks.setPendingBillingChange).toHaveBeenCalledWith('org-id', 'cloud_team_monthly_v1', 4);
		expect(mocks.updatePlanChangeSchedule).toHaveBeenCalledWith(expect.objectContaining({ targetQuantity: 4 }));
	});

	it('applies an increase before releasing a scheduled seat decrease', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 5,
				stripeSubscriptionScheduleId: 'sub_sched_team',
				pendingBillingPlan: 'cloud_team_monthly_v1',
				pendingSeatQuantity: 4,
			}),
		);
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 6 });

		await changeCloudSeatQuantityForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(preview.effective).toBe('immediate');
		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledWith(
			expect.objectContaining({
				targetQuantity: 6,
				intent: expect.objectContaining({ releaseScheduleId: 'sub_sched_team' }),
			}),
		);
		expect(mocks.releasePlanChangeSchedule).toHaveBeenCalledWith('sub_sched_team');
		expect(mocks.updateSubscriptionQuantity.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.releasePlanChangeSchedule.mock.invocationCallOrder[0],
		);
		expect(mocks.clearPendingBillingChange).toHaveBeenCalledWith('org-id');
	});

	it('preserves a scheduled decrease when payment for an increase fails', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 5,
				stripeSubscriptionScheduleId: 'sub_sched_team',
				pendingBillingPlan: 'cloud_team_monthly_v1',
				pendingSeatQuantity: 4,
			}),
		);
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 6 });
		mocks.updateSubscriptionQuantity.mockRejectedValueOnce({ statusCode: 402 });

		await expect(
			changeCloudSeatQuantityForAdmin({
				...adminInput,
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toMatchObject({ codeMessage: 'BAD_REQUEST' });

		expect(mocks.releasePlanChangeSchedule).not.toHaveBeenCalled();
		expect(mocks.clearPendingBillingChange).not.toHaveBeenCalled();
	});

	it('rejects a seat adjustment while a different plan change is pending', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				stripeSubscriptionScheduleId: 'sub_sched_unlimited',
				pendingBillingPlan: 'cloud_unlimited_monthly_v1',
				pendingSeatQuantity: null,
			}),
		);

		await expect(previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 })).rejects.toThrow(
			'Cancel the pending plan change first',
		);
		expect(mocks.previewSubscriptionChange).not.toHaveBeenCalled();
	});

	it('resumes only the pending payment that matches the reviewed change', async () => {
		const pendingPayment = {
			status: 'payment_pending',
			hostedInvoiceUrl: 'https://invoice.stripe.com/existing',
			expiresAt: new Date('2027-01-02T00:00:00.000Z'),
		};
		const requestId = '52a3839e-8ba9-4fd4-8494-a3b590b33155';
		const sevenSeats = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 7 });
		const eightSeats = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 8 });
		mocks.updateSubscriptionQuantity.mockResolvedValueOnce({ ...pendingPayment, subscription: {} });
		await changeCloudSeatQuantityForAdmin({ ...adminInput, previewToken: sevenSeats.previewToken, requestId });
		mocks.getPendingSubscriptionChange.mockResolvedValue({
			...pendingPayment,
			subscription: {
				pending_update: {
					metadata: cloudSubscriptionChangeIntentMetadata(
						mocks.updateSubscriptionQuantity.mock.lastCall![0].intent,
					),
				},
			},
		});

		await expect(
			changeCloudSeatQuantityForAdmin({ ...adminInput, previewToken: eightSeats.previewToken, requestId }),
		).rejects.toMatchObject({ codeMessage: 'CONFLICT' });
		await expect(
			changeCloudSeatQuantityForAdmin({ ...adminInput, previewToken: sevenSeats.previewToken, requestId }),
		).resolves.toMatchObject(pendingPayment);
		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledOnce();
	});

	it('rejects a seat preview after its pending schedule baseline changes', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 6,
				stripeSubscriptionScheduleId: 'sub_sched_team',
				pendingBillingPlan: 'cloud_team_monthly_v1',
				pendingSeatQuantity: 5,
			}),
		);
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 4 });
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 6,
				stripeSubscriptionScheduleId: 'sub_sched_team',
				pendingBillingPlan: 'cloud_team_monthly_v1',
				pendingSeatQuantity: 4,
			}),
		);

		await expect(
			changeCloudSeatQuantityForAdmin({
				...adminInput,
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).rejects.toMatchObject({ codeMessage: 'CONFLICT' });
		expect(mocks.updatePlanChangeSchedule).not.toHaveBeenCalled();
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

	it('returns a hosted invoice without applying a pending plan upgrade', async () => {
		const preview = await previewCloudPlanChangeForAdmin({
			...adminInput,
			targetPlanKey: 'cloud_unlimited_monthly_v1',
		});
		mocks.updateSubscriptionPlan.mockResolvedValueOnce({
			status: 'payment_pending',
			subscription: {},
			hostedInvoiceUrl: 'https://invoice.stripe.com/pending',
			expiresAt: new Date('2027-01-02T00:00:00.000Z'),
		});

		await expect(
			changeCloudPlanForAdmin({
				...adminInput,
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).resolves.toMatchObject({
			status: 'payment_pending',
			hostedInvoiceUrl: 'https://invoice.stripe.com/pending',
			billing: { billingPlan: 'cloud_team_monthly_v1', seatQuantity: 4 },
		});

		expect(mocks.reconcileCustomerUnderLock).toHaveBeenCalledOnce();
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

	it('reactivates a canceled-at-period-end Team subscription while upgrading to Unlimited', async () => {
		const simulatedNow = new Date('2026-11-17T15:05:40.000Z');
		mocks.getOrganizationWithBilling.mockResolvedValue(teamOrganization({ cancellationScheduled: true }));
		mocks.getProrationDate.mockResolvedValue(simulatedNow);
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'active',
			currency: 'usd',
			cancel_at_period_end: true,
		});
		const preview = await previewCloudPlanChangeForAdmin({
			...adminInput,
			targetPlanKey: 'cloud_unlimited_monthly_v1',
		});

		expect(preview.effective).toBe('immediate');
		expect(preview.prorationDate).toEqual(simulatedNow);
		expect(mocks.previewSubscriptionChange).toHaveBeenCalledWith(
			expect.objectContaining({ prorationDate: simulatedNow }),
		);
		await changeCloudPlanForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(mocks.updateSubscriptionPlan).toHaveBeenCalledWith(
			expect.objectContaining({
				targetPlanKey: 'cloud_unlimited_monthly_v1',
				targetQuantity: 1,
				chargeImmediately: true,
				prorationDate: simulatedNow,
			}),
		);
		expect(mocks.setSubscriptionCancellation).not.toHaveBeenCalled();
	});

	it('previews and applies a promotion code while changing a trial plan', async () => {
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: false,
			trial_end: 1_800_000_000,
		});
		mocks.findPromotionCode.mockResolvedValue({
			id: 'promo_launch',
			discountedPlanAmount: 160_000,
			duration: 'forever',
		});
		const preview = await previewCloudPlanChangeForAdmin({
			...adminInput,
			targetPlanKey: 'cloud_unlimited_monthly_v1',
			promotionCode: ' LAUNCH20 ',
		});

		await changeCloudPlanForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(mocks.findPromotionCode).toHaveBeenCalledWith({
			code: 'LAUNCH20',
			stripeCustomerId: 'cus_cloud',
			targetPlanKey: 'cloud_unlimited_monthly_v1',
			targetQuantity: 1,
			currency: 'usd',
		});
		expect(preview.promotionCodeDiscount).toEqual({ amount: 160_000, duration: 'forever' });
		expect(mocks.previewSubscriptionChange).toHaveBeenCalledWith(
			expect.objectContaining({ promotionCodeId: 'promo_launch' }),
		);
		expect(mocks.updateSubscriptionPlan).toHaveBeenCalledWith(
			expect.objectContaining({
				chargeImmediately: false,
				promotionCodeId: 'promo_launch',
			}),
		);
	});

	it('rejects an unknown promotion code before previewing the change', async () => {
		await expect(
			previewCloudPlanChangeForAdmin({
				...adminInput,
				targetPlanKey: 'cloud_unlimited_monthly_v1',
				promotionCode: 'UNKNOWN',
			}),
		).rejects.toThrow('Promotion code is invalid or expired');

		expect(mocks.previewSubscriptionChange).not.toHaveBeenCalled();
	});

	it.each([
		['seat change', () => previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 5 })],
		[
			'member seat purchase',
			() =>
				previewCloudMemberSeatPurchaseForAdmin({
					...adminInput,
					memberUserId: 'member-id',
					requestedRole: 'user',
				}),
		],
	])('keeps Free after the trial by rejecting a trial %s', async (_operation, preview) => {
		mocks.getOrganizationWithBilling.mockResolvedValue(teamOrganization({ cancellationScheduled: true }));
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: true,
			trial_end: 1_800_000_000,
		});

		await expect(preview()).rejects.toThrow('Keep your plan before making another billing change');
		expect(mocks.previewSubscriptionChange).not.toHaveBeenCalled();
	});

	it('rejects plan changes for a subscription Stripe has already canceled', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(teamOrganization());
		mocks.getSubscription.mockResolvedValue({ id: 'sub_team', status: 'canceled', currency: 'usd' });

		await expect(
			previewCloudPlanChangeForAdmin({ ...adminInput, targetPlanKey: 'cloud_unlimited_monthly_v1' }),
		).rejects.toThrow('No current paid subscription is available');
	});

	it('schedules a trial seat decrease for the trial end', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(
			teamOrganization({
				seatQuantity: 6,
				trialEndsAt: new Date('2027-02-01T00:00:00.000Z'),
			}),
		);
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: false,
			trial_end: 1_801_440_000,
		});
		const preview = await previewCloudSeatChangeForAdmin({ ...adminInput, targetQuantity: 4 });

		await changeCloudSeatQuantityForAdmin({
			...adminInput,
			previewToken: preview.previewToken,
			requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
		});

		expect(preview.effective).toBe('period_end');
		expect(preview.firstChargeAt).toEqual(new Date('2027-02-01T00:00:00.000Z'));
		expect(mocks.updateSubscriptionQuantity).not.toHaveBeenCalled();
		expect(mocks.createPlanChangeSchedule).toHaveBeenCalledOnce();
	});

	it('does not carry a stale trial read-only assignment into a covered Team preview', async () => {
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: false,
		});
		mocks.listSeatCandidates.mockResolvedValue(
			Array.from({ length: 4 }, (_, index) => ({
				id: `user-${index}`,
				name: `User ${index}`,
				email: `user-${index}@example.com`,
				membershipClass: index === 0 ? 'org_admin' : 'org_member',
				orgRole: index === 0 ? 'admin' : 'user',
				projectRoles: [],
				joinedAt: new Date(),
				selectedAt: null,
				storedReadOnly: index === 3,
			})),
		);

		const preview = await previewCloudPlanChangeForAdmin({
			...adminInput,
			targetPlanKey: 'cloud_team_monthly_v1',
			targetSeatQuantity: 7,
		});

		expect(preview.readOnlyUsersAfterChange).toEqual([]);
	});

	it('includes an explicitly deselected trial user in the Team preview warning', async () => {
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: false,
		});
		mocks.listSeatCandidates.mockResolvedValue(
			Array.from({ length: 4 }, (_, index) => ({
				id: `user-${index}`,
				name: `User ${index}`,
				email: `user-${index}@example.com`,
				membershipClass: index === 0 ? 'org_admin' : 'org_member',
				orgRole: index === 0 ? 'admin' : 'user',
				projectRoles: [],
				joinedAt: new Date(),
				selectedAt: null,
				selectionExplicit: index === 3,
				storedReadOnly: false,
			})),
		);

		const preview = await previewCloudPlanChangeForAdmin({
			...adminInput,
			targetPlanKey: 'cloud_team_monthly_v1',
			targetSeatQuantity: 7,
		});

		expect(preview.readOnlyUsersAfterChange).toEqual([expect.objectContaining({ userId: 'user-3' })]);
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
		expect(mocks.setPendingFreeSeatSelection).toHaveBeenCalledWith('org-id', null);
	});

	it('keeps paid seat access while saving the selection for Free', async () => {
		mocks.listSeatCandidates.mockResolvedValue([
			{
				id: 'user-id',
				name: 'Admin',
				email: 'admin@example.com',
				membershipClass: 'org_admin',
				orgRole: 'admin',
				projectRoles: [],
				joinedAt: new Date(),
				selectedAt: null,
				storedReadOnly: false,
			},
			{
				id: 'member-id',
				name: 'Member',
				email: 'member@example.com',
				membershipClass: 'org_member',
				orgRole: 'user',
				projectRoles: [],
				joinedAt: new Date(),
				selectedAt: null,
				storedReadOnly: false,
			},
		]);

		await switchCloudSubscriptionToFreeForAdmin({
			...adminInput,
			selectedUserIds: ['member-id'],
		});

		expect(mocks.setPendingFreeSeatSelection).toHaveBeenCalledWith('org-id', ['member-id']);
		expect(mocks.setSeatSelection).not.toHaveBeenCalled();
		expect(mocks.syncSeatState).not.toHaveBeenCalled();
	});

	it('does not apply a Free seat selection while scheduling Free after a trial', async () => {
		mocks.getSubscription.mockResolvedValue({
			id: 'sub_team',
			status: 'trialing',
			currency: 'usd',
			cancel_at_period_end: false,
		});

		await switchCloudSubscriptionToFreeForAdmin({
			...adminInput,
			selectedUserIds: ['member-id'],
		});

		expect(mocks.setSubscriptionCancellation).toHaveBeenCalledWith(
			expect.objectContaining({ cancelAtPeriodEnd: true }),
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
		).resolves.toMatchObject({
			status: 'completed',
			membership: { userId: 'member-id', role: 'user' },
		});

		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledOnce();
	});

	it('does not activate a member while payment for their seat is pending', async () => {
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
		mocks.updateSubscriptionQuantity.mockResolvedValueOnce({
			status: 'payment_pending',
			subscription: {},
			hostedInvoiceUrl: 'https://invoice.stripe.com/member-seat',
			expiresAt: new Date('2027-01-02T00:00:00.000Z'),
		});

		await expect(
			addCloudMemberWithSeatForAdmin({
				...adminInput,
				memberUserId: 'member-id',
				requestedRole: 'user',
				previewToken: preview.previewToken,
				requestId: '52a3839e-8ba9-4fd4-8494-a3b590b33155',
			}),
		).resolves.toMatchObject({
			status: 'payment_pending',
			hostedInvoiceUrl: 'https://invoice.stripe.com/member-seat',
		});

		expect(mocks.putMember).not.toHaveBeenCalled();
		expect(mocks.updateSubscriptionQuantity).toHaveBeenCalledWith(
			expect.objectContaining({
				intent: expect.objectContaining({ member: { userId: 'member-id', role: 'user' } }),
			}),
		);
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
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
			...billingOverrides,
		},
	};
}
