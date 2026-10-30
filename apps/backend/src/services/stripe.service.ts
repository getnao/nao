import Stripe from 'stripe';

import { env, isCloudBillingEnabled, isCloudFreeTierEnabled } from '../env';
import type { SubscriptionProjection } from '../queries/billing.queries';
import {
	BILLING_STATUSES,
	type BillingStatus,
	CLOUD_BILLING_CURRENCIES,
	CLOUD_BILLING_PLANS,
	type CloudBillingCurrency,
	type CloudBillingInterval,
	type CloudBillingPlan,
	type CloudBillingPlanDefinition,
	type CloudBillingPlanKey,
	type CurrentCloudBillingPlanDefinition,
	getCloudBillingPlanDefinition,
	isCloudBillingPlanKey,
	isLegacyCloudBillingPlanKey,
	isTerminalBillingStatus,
	LEGACY_CLOUD_BILLING_PLANS,
	type LegacyCloudBillingPlanDefinition,
	type LegacyCloudBillingPlanKey,
	type PaidCloudBillingTier,
} from '../types/billing';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia';
const CLOUD_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const SUBSCRIPTION_CURRENCY_CACHE_LIMIT = 1_000;
const ORGANIZATION_METADATA_KEY = 'nao_org_id';
const PLAN_METADATA_KEY = 'nao_plan_key';
const SUBSCRIPTION_KIND_METADATA_KEY = 'nao_subscription_kind';
const TRIAL_PLACEHOLDER_KIND = 'trial-placeholder';
const CHECKOUT_KIND_METADATA_KEY = 'nao_checkout_kind';
const CREDIT_TOP_UP_CHECKOUT_KIND = 'credit_top_up';
const TRIAL_END_METADATA_KEY = 'nao_trial_end';
const MIN_CHECKOUT_TRIAL_MS = 48 * 60 * 60 * 1000;
const CHECKOUT_TRIAL_CLOCK_SKEW_MS = 5 * 60 * 1000;

type CloudRecurringPriceDetails = Stripe.Price & {
	recurring: Stripe.Price.Recurring;
	unit_amount: number;
};

type CloudPrice = CloudRecurringPriceDetails & {
	product: Stripe.Product;
};

type CloudTrialPrice = Stripe.Price & {
	product: Stripe.Product;
	recurring: Stripe.Price.Recurring;
	unit_amount: 0;
};

type CloudSubscriptionItem = Stripe.SubscriptionItem & {
	price: CloudRecurringPriceDetails;
};

type CloudPaidProductItem = {
	item: CloudSubscriptionItem;
	tier: PaidCloudBillingTier;
	legacy: boolean;
};

export type CloudSubscriptionKind = 'paid-cloud' | 'trial-placeholder';

export interface ClassifiedCloudSubscription {
	kind: CloudSubscriptionKind;
	subscription: Stripe.Subscription;
}

interface CloudInvoice {
	id: string;
	number: string | null;
	invoiceKind: 'trial' | 'subscription' | 'credit_top_up' | 'no_charge';
	promotionCodes: string[];
	status: Stripe.Invoice.Status | null;
	createdAt: Date;
	total: number;
	currency: string;
	hostedInvoiceUrl: string | null;
	invoicePdf: string | null;
}

interface CloudUpcomingInvoice {
	amountDue: number;
	currency: string;
	nextPaymentAt: Date;
	promotionCodes: string[];
}

export interface CloudSubscriptionChangePreview {
	amountDue: number;
	subtotal: number;
	tax: number;
	discount: number;
	currency: CloudBillingCurrency;
	lines: Array<{
		description: string;
		amount: number;
		currency: CloudBillingCurrency;
		proration: boolean;
		periodStartsAt: Date | null;
		periodEndsAt: Date | null;
	}>;
}

export interface StripeAccountInvoice {
	id: string;
	number: string | null;
	stripeCustomerId: string | null;
	status: Stripe.Invoice.Status | null;
	billingReason: Stripe.Invoice.BillingReason | null;
	invoiceKind: 'subscription' | 'credit_top_up';
	total: number;
	amountPaid: number;
	currency: string;
	attemptCount: number;
	createdAt: Date;
	paidAt: Date | null;
	hostedInvoiceUrl: string | null;
}

export interface CloudSubscriptionRevenue {
	id: string;
	stripeCustomerId: string;
	status: Stripe.Subscription.Status;
	currency: string;
	monthlyAmount: number;
}

export class CloudInitialCheckoutUnavailableError extends Error {}

export class CloudSubscriptionUnavailableError extends Error {}

export class CloudSubscriptionResumeError extends Error {}

let stripeClient: Stripe | undefined;
const cloudPriceCache = new Map<
	CloudBillingPlanKey | LegacyCloudBillingPlanKey,
	{ lookupKey: string; productId: string; expiresAt: number; price: Promise<CloudPrice> }
>();
let cloudTrialPriceCache:
	| { lookupKey: string; productId: string; expiresAt: number; price: Promise<CloudTrialPrice> }
	| undefined;
const subscriptionCurrencyCache = new Map<string, Promise<string>>();
const priceCurrencyOptionsCache = new Map<string, Promise<Stripe.Price>>();

export async function createCloudCustomer(input: {
	organizationId: string;
	organizationName: string;
	adminEmail: string;
}): Promise<Stripe.Customer> {
	return getStripeClient().customers.create(
		{
			name: input.organizationName,
			email: input.adminEmail,
			metadata: { [ORGANIZATION_METADATA_KEY]: input.organizationId },
		},
		{ idempotencyKey: `cloud-customer-v2:${input.organizationId}` },
	);
}

export async function createCloudTrialPlaceholderSubscription(input: {
	organizationId: string;
	stripeCustomerId: string;
	trialEnd: Date;
}): Promise<Stripe.Subscription> {
	if (input.trialEnd.getTime() <= Date.now()) {
		throw new Error('The organization trial has expired');
	}
	const price = await getCloudTrialPrice();
	return getStripeClient().subscriptions.create(
		{
			customer: input.stripeCustomerId,
			items: [{ price: price.id, quantity: 1 }],
			metadata: {
				[ORGANIZATION_METADATA_KEY]: input.organizationId,
				[SUBSCRIPTION_KIND_METADATA_KEY]: TRIAL_PLACEHOLDER_KIND,
			},
			cancel_at: stripeTimestamp(input.trialEnd),
			trial_end: stripeTimestamp(input.trialEnd),
			trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
		},
		{ idempotencyKey: `cloud-trial-placeholder-v1:${input.organizationId}` },
	);
}

export async function createCloudCheckoutSession(
	input: {
		billingInterval?: CloudBillingInterval;
		planKey?: CloudBillingPlanKey;
		quantity?: number;
		currency?: CloudBillingCurrency;
		organizationId: string;
		stripeCustomerId: string;
	} & ({ trialDays: number; trialEnd?: never } | { trialDays?: never; trialEnd: Date }),
): Promise<string> {
	const classified = await listCloudSubscriptions(input.stripeCustomerId);
	const hasPaidHistory = classified.some(({ kind }) => kind === 'paid-cloud');
	const currentPlaceholders = classified.filter(
		({ kind, subscription }) => kind === 'trial-placeholder' && !isTerminalBillingStatus(subscription.status),
	);
	if (hasPaidHistory || (classified.length > 0 && currentPlaceholders.length !== 1)) {
		throw new CloudInitialCheckoutUnavailableError(
			'This organization already has cloud subscription history; use resubscribe instead',
		);
	}
	if (input.trialEnd && input.trialEnd.getTime() <= Date.now()) {
		throw new CloudInitialCheckoutUnavailableError('This organization trial has expired');
	}
	const preservesTrial =
		input.trialEnd !== undefined &&
		input.trialEnd.getTime() >= Date.now() + MIN_CHECKOUT_TRIAL_MS + CHECKOUT_TRIAL_CLOCK_SKEW_MS;
	const sourceTrialEnd = preservesTrial ? stripeTimestamp(input.trialEnd) : null;
	return createSubscriptionCheckoutSession({
		...input,
		trialEnd: preservesTrial ? input.trialEnd : undefined,
		currency: input.currency ?? 'usd',
		kind: 'initial',
		operationKey:
			input.trialDays !== undefined
				? `trial-${input.trialDays}`
				: sourceTrialEnd === null
					? 'immediate'
					: `trial-${sourceTrialEnd}-${sourceTrialEnd}`,
		effectiveTrialEnd: sourceTrialEnd,
	});
}

export async function createCloudResubscribeSession(input: {
	billingInterval?: CloudBillingInterval;
	planKey?: CloudBillingPlanKey;
	quantity?: number;
	currency?: CloudBillingCurrency;
	organizationId: string;
	stripeCustomerId: string;
	allowMissingHistory?: boolean;
}): Promise<string> {
	const classified = await listCloudSubscriptions(input.stripeCustomerId);
	if (classified.some(({ subscription }) => !isTerminalBillingStatus(subscription.status))) {
		throw new CloudSubscriptionUnavailableError('This organization already has a current subscription');
	}
	const latestSubscription = [...classified].sort(
		(left, right) => right.subscription.created - left.subscription.created,
	)[0]?.subscription;
	if (!latestSubscription && !input.allowMissingHistory) {
		throw new CloudSubscriptionUnavailableError('This organization has no subscription history');
	}
	return createSubscriptionCheckoutSession({
		...input,
		currency: input.currency ?? 'usd',
		kind: 'resubscribe',
		operationKey: latestSubscription?.id ?? 'missing-subscription',
	});
}

async function createSubscriptionCheckoutSession(input: {
	billingInterval?: CloudBillingInterval;
	planKey?: CloudBillingPlanKey;
	quantity?: number;
	currency: CloudBillingCurrency;
	organizationId: string;
	stripeCustomerId: string;
	kind: 'initial' | 'resubscribe';
	operationKey: string;
	trialDays?: number;
	trialEnd?: Date;
	effectiveTrialEnd?: number | null;
}): Promise<string> {
	const plan = input.planKey
		? CLOUD_BILLING_PLANS[input.planKey]
		: legacyCloudBillingPlanDefinition(requireCloudBillingInterval(input.billingInterval));
	const quantity = input.planKey ? (input.quantity ?? 1) : 1;
	const sourceTrialEnd = input.trialEnd ? stripeTimestamp(input.trialEnd) : null;
	const effectiveTrialEnd = input.effectiveTrialEnd ?? null;
	const trialMessage =
		input.trialDays !== undefined
			? checkoutTrialDaysMessage(input.trialDays)
			: effectiveTrialEnd !== null
				? checkoutTrialMessage(new Date(effectiveTrialEnd * 1_000))
				: input.kind === 'initial'
					? checkoutImmediateStartMessage()
					: null;
	const matchesCheckout = (session: Stripe.Checkout.Session) =>
		session.mode === 'subscription' &&
		session.currency === input.currency &&
		session.allow_promotion_codes === true &&
		session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
		session.metadata?.[PLAN_METADATA_KEY] === plan.key &&
		(input.planKey === undefined || session.metadata?.nao_quantity === String(quantity)) &&
		session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind &&
		(session.metadata?.[TRIAL_END_METADATA_KEY] ?? null) ===
			(sourceTrialEnd === null ? null : String(sourceTrialEnd)) &&
		(trialMessage === null || session.custom_text?.submit?.message === trialMessage);
	const existingSession = await reuseOrExpireOpenCheckoutSessions(input, matchesCheckout);
	if (existingSession?.url) {
		return existingSession.url;
	}
	const latestExpiredSession = await findCheckoutSession(input.stripeCustomerId, 'expired', matchesCheckout);

	const price = input.planKey
		? await getCloudPrice(input.planKey)
		: await getLegacyCloudPrice(requireCloudBillingInterval(input.billingInterval));
	const billingUrl = billingPageUrl();
	const session = await getStripeClient().checkout.sessions.create(
		{
			mode: 'subscription',
			currency: input.currency,
			customer: input.stripeCustomerId,
			customer_update: { address: 'auto', name: 'auto' },
			automatic_tax: { enabled: true },
			tax_id_collection: { enabled: true },
			billing_address_collection: 'required',
			client_reference_id: input.organizationId,
			line_items: [{ price: price.id, quantity }],
			allow_promotion_codes: true,
			payment_method_collection: 'always',
			payment_method_types: ['card'],
			...(trialMessage ? { custom_text: { submit: { message: trialMessage } } } : {}),
			metadata: {
				[ORGANIZATION_METADATA_KEY]: input.organizationId,
				[PLAN_METADATA_KEY]: plan.key,
				[CHECKOUT_KIND_METADATA_KEY]: input.kind,
				...(input.planKey ? { nao_quantity: String(quantity) } : {}),
				...(sourceTrialEnd === null ? {} : { [TRIAL_END_METADATA_KEY]: String(sourceTrialEnd) }),
			},
			subscription_data: {
				metadata: {
					[ORGANIZATION_METADATA_KEY]: input.organizationId,
					[PLAN_METADATA_KEY]: plan.key,
				},
				...(input.trialDays !== undefined
					? {
							trial_period_days: input.trialDays,
							trial_settings: { end_behavior: { missing_payment_method: 'pause' as const } },
						}
					: effectiveTrialEnd !== null
						? {
								trial_end: effectiveTrialEnd,
								trial_settings: { end_behavior: { missing_payment_method: 'pause' as const } },
							}
						: {}),
			},
			success_url: `${billingUrl}?checkout=${input.kind === 'initial' ? 'success' : 'subscribed'}`,
			cancel_url: `${billingUrl}?checkout=canceled`,
		},
		{
			idempotencyKey: `cloud-checkout-${input.kind}-v12:${input.organizationId}:${plan.key}:${input.currency}:${input.operationKey}${input.planKey ? `:${quantity}` : ''}${latestExpiredSession ? `:${latestExpiredSession.id}` : ''}`,
		},
	);
	if (!session.url) {
		throw new Error('Stripe did not return a Checkout URL');
	}
	return session.url;
}

export async function createCloudPortalSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	requestId: string;
}): Promise<string> {
	const session = await getStripeClient().billingPortal.sessions.create(
		{
			customer: input.stripeCustomerId,
			return_url: `${billingPageUrl()}?portal=returned`,
			...(env.STRIPE_PORTAL_CONFIGURATION_ID ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID } : {}),
		},
		{ idempotencyKey: `cloud-portal-v2:${input.organizationId}:${input.requestId}` },
	);
	return session.url;
}

export async function createCloudPaymentMethodSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	requestId: string;
}): Promise<string> {
	const returnUrl = `${billingPageUrl()}?portal=returned`;
	const session = await getStripeClient().billingPortal.sessions.create(
		{
			customer: input.stripeCustomerId,
			return_url: returnUrl,
			flow_data: {
				type: 'payment_method_update',
				after_completion: {
					type: 'redirect',
					redirect: { return_url: returnUrl },
				},
			},
			...(env.STRIPE_PORTAL_CONFIGURATION_ID ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID } : {}),
		},
		{ idempotencyKey: `cloud-payment-method-v2:${input.organizationId}:${input.requestId}` },
	);
	return session.url;
}

export async function listCloudInvoices(stripeCustomerId: string): Promise<CloudInvoice[]> {
	const invoices: Stripe.Invoice[] = [];
	for await (const invoice of getStripeClient().invoices.list({
		customer: stripeCustomerId,
		expand: ['data.discounts.promotion_code'],
		limit: 100,
	})) {
		invoices.push(invoice);
	}
	return invoices.map((invoice) => ({
		id: invoice.id,
		number: invoice.number,
		invoiceKind: isCreditTopUpInvoice(invoice)
			? 'credit_top_up'
			: invoice.total !== 0
				? 'subscription'
				: invoice.billing_reason === 'subscription_create' && invoice.subtotal === 0
					? 'trial'
					: 'no_charge',
		promotionCodes: invoicePromotionCodes(invoice),
		status: invoice.status,
		createdAt: new Date(invoice.created * 1_000),
		total: invoice.total,
		currency: invoice.currency,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		invoicePdf: invoice.invoice_pdf ?? null,
	}));
}

export async function getCloudUpcomingInvoice(stripeSubscriptionId: string): Promise<CloudUpcomingInvoice> {
	const invoice = await getStripeClient().invoices.createPreview({
		subscription: stripeSubscriptionId,
		expand: ['discounts.promotion_code'],
	});
	return {
		amountDue: invoice.amount_due,
		currency: invoice.currency,
		nextPaymentAt: new Date(invoice.period_start * 1_000),
		promotionCodes: invoicePromotionCodes(invoice),
	};
}

export async function previewCloudSubscriptionChange(input: {
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	prorationDate: Date;
	prorationBehavior: 'always_invoice' | 'none';
}): Promise<CloudSubscriptionChangePreview> {
	const paidItem = requireCloudPaidProductItem(input.subscription);
	const price = await getCloudPrice(input.targetPlanKey);
	const invoice = await getStripeClient().invoices.createPreview({
		subscription: input.subscription.id,
		subscription_details: {
			items: [{ id: paidItem.item.id, price: price.id, quantity: input.targetQuantity }],
			proration_date: stripeTimestamp(input.prorationDate),
			proration_behavior: input.prorationBehavior,
		},
	});
	const currency = assertCloudBillingCurrency(invoice.currency);
	return {
		amountDue: invoice.amount_due,
		subtotal: invoice.subtotal,
		tax: (invoice.total_taxes ?? []).reduce((total, tax) => total + tax.amount, 0),
		discount: (invoice.total_discount_amounts ?? []).reduce((total, discount) => total + discount.amount, 0),
		currency,
		lines: invoice.lines.data.map((line) => ({
			description: line.description ?? '',
			amount: line.amount,
			currency: assertCloudBillingCurrency(line.currency),
			proration: line.parent?.subscription_item_details?.proration === true,
			periodStartsAt: stripeDate(line.period?.start ?? null),
			periodEndsAt: stripeDate(line.period?.end ?? null),
		})),
	};
}

export async function updateCloudSubscriptionQuantity(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetQuantity: number;
	prorationDate: Date;
	requestId: string;
}): Promise<Stripe.Subscription> {
	const paidItem = requireCloudPaidProductItem(input.subscription);
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	const currentQuantity = paidItem.item.quantity ?? 1;
	const paidIncrease = input.subscription.status !== 'trialing' && input.targetQuantity > currentQuantity;
	return getStripeClient().subscriptions.update(
		input.subscription.id,
		{
			items: [{ id: paidItem.item.id, quantity: input.targetQuantity }],
			proration_behavior: paidIncrease ? 'always_invoice' : 'none',
			proration_date: stripeTimestamp(input.prorationDate),
			...(paidIncrease ? { payment_behavior: 'error_if_incomplete' as const } : {}),
		},
		{
			idempotencyKey: `cloud-seat-quantity-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}:${input.targetQuantity}`,
		},
	);
}

export async function updateCloudSubscriptionPlan(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	prorationDate: Date;
	requestId: string;
	chargeImmediately: boolean;
}): Promise<Stripe.Subscription> {
	const paidItem = requireCloudPaidProductItem(input.subscription);
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	const price = await getCloudPrice(input.targetPlanKey);
	const paidUpgrade = input.subscription.status !== 'trialing' && input.chargeImmediately;
	return getStripeClient().subscriptions.update(
		input.subscription.id,
		{
			items: [{ id: paidItem.item.id, price: price.id, quantity: input.targetQuantity }],
			proration_behavior: paidUpgrade ? 'always_invoice' : 'none',
			proration_date: stripeTimestamp(input.prorationDate),
			...(paidUpgrade ? { payment_behavior: 'error_if_incomplete' as const } : {}),
			...(input.subscription.status === 'trialing' && input.subscription.trial_end
				? { trial_end: input.subscription.trial_end }
				: {}),
		},
		{
			idempotencyKey: `cloud-plan-change-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}:${input.targetPlanKey}:${input.targetQuantity}`,
		},
	);
}

export async function setCloudSubscriptionCancellation(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	cancelAtPeriodEnd: boolean;
	requestId: string;
}): Promise<Stripe.Subscription> {
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	return getStripeClient().subscriptions.update(
		input.subscription.id,
		{ cancel_at_period_end: input.cancelAtPeriodEnd, proration_behavior: 'none' },
		{
			idempotencyKey: `cloud-switch-free-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}`,
		},
	);
}

export async function createCloudPlanChangeSchedule(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	requestId: string;
}): Promise<Stripe.SubscriptionSchedule> {
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	return getStripeClient().subscriptionSchedules.create(
		{ from_subscription: input.subscription.id },
		{
			idempotencyKey: `cloud-plan-schedule-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}:${input.targetPlanKey}`,
		},
	);
}

export async function getCloudPlanChangeSchedule(scheduleId: string): Promise<Stripe.SubscriptionSchedule> {
	return getStripeClient().subscriptionSchedules.retrieve(scheduleId, {
		expand: ['phases.items.price.product'],
	});
}

export async function updateCloudPlanChangeSchedule(input: {
	schedule: Stripe.SubscriptionSchedule;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	effectiveAt: Date;
}): Promise<Stripe.SubscriptionSchedule> {
	const price = await getCloudPrice(input.targetPlanKey);
	const currentPhase = input.schedule.phases.find(
		(phase) =>
			phase.start_date <= stripeTimestamp(input.effectiveAt) &&
			phase.end_date >= stripeTimestamp(input.effectiveAt),
	);
	if (!currentPhase) {
		throw new Error(`Stripe Subscription Schedule "${input.schedule.id}" has no current phase`);
	}
	const currentPhaseParams = copyCloudSchedulePhase(
		currentPhase,
		currentPhase.start_date,
		stripeTimestamp(input.effectiveAt),
	);
	const {
		start_date: _currentStartDate,
		end_date: _currentEndDate,
		items: _currentItems,
		...futurePhaseSettings
	} = copyCloudSchedulePhase(currentPhase, currentPhase.start_date, stripeTimestamp(input.effectiveAt));
	return getStripeClient().subscriptionSchedules.update(input.schedule.id, {
		end_behavior: 'release',
		proration_behavior: 'none',
		phases: [
			currentPhaseParams,
			{
				...futurePhaseSettings,
				start_date: stripeTimestamp(input.effectiveAt),
				items: [{ price: price.id, quantity: input.targetQuantity }],
				proration_behavior: 'none',
			},
		],
	});
}

export async function releaseCloudPlanChangeSchedule(scheduleId: string): Promise<Stripe.SubscriptionSchedule> {
	return getStripeClient().subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true });
}

export async function listStripeInvoicesCreatedSince(createdSince: Date): Promise<StripeAccountInvoice[]> {
	const invoices: StripeAccountInvoice[] = [];
	for await (const invoice of getStripeClient().invoices.list({
		created: { gte: Math.floor(createdSince.getTime() / 1_000) },
		limit: 100,
	})) {
		invoices.push({
			id: invoice.id,
			number: invoice.number,
			stripeCustomerId: invoice.customer ? stripeCustomerId(invoice.customer) : null,
			status: invoice.status,
			billingReason: invoice.billing_reason,
			invoiceKind: isCreditTopUpInvoice(invoice) ? 'credit_top_up' : 'subscription',
			total: invoice.total,
			amountPaid: invoice.amount_paid,
			currency: invoice.currency,
			attemptCount: invoice.attempt_count,
			createdAt: new Date(invoice.created * 1_000),
			paidAt: stripeDate(invoice.status_transitions.paid_at ?? null),
			hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		});
	}
	return invoices;
}

/** Monthly amounts are normalized from the plan interval and net of recurring coupons. */
export async function listCurrentCloudSubscriptions(): Promise<CloudSubscriptionRevenue[]> {
	const subscriptions: CloudSubscriptionRevenue[] = [];
	for (const status of ['active', 'past_due', 'trialing'] as const) {
		for await (const subscription of getStripeClient().subscriptions.list({
			status,
			expand: ['data.discounts.source.coupon'],
			limit: 100,
		})) {
			const paidItem = cloudPaidProductItem(subscription);
			if (!paidItem) {
				continue;
			}
			subscriptions.push({
				id: subscription.id,
				stripeCustomerId: stripeCustomerId(subscription.customer),
				status: subscription.status,
				currency: subscription.currency,
				monthlyAmount: await monthlyRecurringAmount(subscription, paidItem.item),
			});
		}
	}
	return subscriptions;
}

export function stripeDashboardUrl(path: string): string {
	return `https://dashboard.stripe.com/${isStripeLiveMode() ? '' : 'test/'}${path}`;
}

export function isStripeLiveMode(): boolean {
	return /^[rs]k_live_/.test(env.STRIPE_SECRET_KEY ?? '');
}

export async function resumeCloudSubscription(input: {
	organizationId: string;
	stripeSubscriptionId: string;
	requestId: string;
}): Promise<Stripe.Subscription> {
	const subscription = await getCloudSubscription(input.stripeSubscriptionId);
	if (subscription.status !== 'paused') {
		throw new CloudSubscriptionResumeError('Only a paused subscription can be resumed');
	}

	if (
		!hasSubscriptionDefaultPaymentMethod(subscription) &&
		!(await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer)))
	) {
		throw new CloudSubscriptionResumeError('Add a payment method before resuming the subscription');
	}

	return getStripeClient().subscriptions.resume(
		subscription.id,
		{},
		{ idempotencyKey: `cloud-resume-v2:${input.organizationId}:${input.requestId}` },
	);
}

export async function updateCloudPaidSubscriptionTrialEnd(
	subscription: Stripe.Subscription,
	organizationId: string,
	trialEnd: Date,
): Promise<Stripe.Subscription> {
	if (cloudSubscriptionKind(subscription) !== 'paid-cloud') {
		throw new Error(`Stripe Subscription "${subscription.id}" is not a paid cloud Subscription`);
	}
	assertCloudSubscriptionOrganization(subscription, organizationId);
	return getStripeClient().subscriptions.update(
		subscription.id,
		{ proration_behavior: 'none', trial_end: stripeTimestamp(trialEnd) },
		{
			idempotencyKey: `cloud-paid-trial-end-v1:${organizationId}:${subscription.id}:${stripeTimestamp(trialEnd)}`,
		},
	);
}

export async function cancelCloudTrialPlaceholderSubscription(
	subscription: Stripe.Subscription,
	organizationId: string,
): Promise<Stripe.Subscription> {
	if (cloudSubscriptionKind(subscription) !== 'trial-placeholder') {
		throw new Error(`Stripe Subscription "${subscription.id}" is not a cloud trial placeholder`);
	}
	assertCloudSubscriptionOrganization(subscription, organizationId);
	return getStripeClient().subscriptions.cancel(
		subscription.id,
		{},
		{ idempotencyKey: `cloud-trial-placeholder-cancel-v1:${organizationId}:${subscription.id}` },
	);
}

export async function hasCloudDefaultPaymentMethod(stripeCustomerIdValue: string): Promise<boolean> {
	const customer = await getStripeClient().customers.retrieve(stripeCustomerIdValue);
	return !customer.deleted && Boolean(customer.invoice_settings.default_payment_method || customer.default_source);
}

export function cloudSubscriptionKind(subscription: Stripe.Subscription): CloudSubscriptionKind | null {
	const paidItem = cloudPaidProductItem(subscription);
	const placeholderItem = cloudTrialPlaceholderItem(subscription);
	if (paidItem) {
		return 'paid-cloud';
	}
	return placeholderItem ? 'trial-placeholder' : null;
}

export async function listCloudSubscriptions(stripeCustomerIdValue: string): Promise<ClassifiedCloudSubscription[]> {
	const subscriptions: ClassifiedCloudSubscription[] = [];
	for await (const subscription of getStripeClient().subscriptions.list({
		customer: stripeCustomerIdValue,
		status: 'all',
		limit: 100,
	})) {
		const kind = cloudSubscriptionKind(subscription);
		if (kind) {
			subscriptions.push({ kind, subscription });
		}
	}
	return subscriptions;
}

export async function getCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
	const subscription = await findCloudSubscription(stripeSubscriptionId);
	if (!subscription) {
		throw new Error(`Stripe Subscription "${stripeSubscriptionId}" does not use the configured cloud Product`);
	}
	return subscription;
}

/** A subscription's currency never changes, so entries only need eviction to bound memory. */
export function getCloudSubscriptionCurrency(stripeSubscriptionId: string): Promise<string> {
	const cached = subscriptionCurrencyCache.get(stripeSubscriptionId);
	if (cached) {
		return cached;
	}
	if (subscriptionCurrencyCache.size >= SUBSCRIPTION_CURRENCY_CACHE_LIMIT) {
		subscriptionCurrencyCache.clear();
	}
	const currency = getCloudSubscription(stripeSubscriptionId).then((subscription) => subscription.currency);
	subscriptionCurrencyCache.set(stripeSubscriptionId, currency);
	currency.catch(() => {
		if (subscriptionCurrencyCache.get(stripeSubscriptionId) === currency) {
			subscriptionCurrencyCache.delete(stripeSubscriptionId);
		}
	});
	return currency;
}

export async function findCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription | null> {
	const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
	return cloudPaidProductItem(subscription) ? subscription : null;
}

export async function findManagedCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription | null> {
	const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
	return cloudSubscriptionKind(subscription) ? subscription : null;
}

export async function getCloudCheckoutSubscription(
	stripeCheckoutSessionId: string,
): Promise<{ session: Stripe.Checkout.Session; subscription: Stripe.Subscription }> {
	const session = await getStripeClient().checkout.sessions.retrieve(stripeCheckoutSessionId);
	if (!session.subscription) {
		throw new Error(`Stripe Checkout Session "${stripeCheckoutSessionId}" has no Subscription`);
	}
	const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
	return { session, subscription: await getCloudSubscription(subscriptionId) };
}

export async function getStripeEvent(stripeEventId: string): Promise<Stripe.Event> {
	return getStripeClient().events.retrieve(stripeEventId);
}

export async function getStripeCheckoutSession(stripeCheckoutSessionId: string): Promise<Stripe.Checkout.Session> {
	return getStripeClient().checkout.sessions.retrieve(stripeCheckoutSessionId);
}

export async function getStripeInvoice(stripeInvoiceId: string): Promise<Stripe.Invoice> {
	return getStripeClient().invoices.retrieve(stripeInvoiceId);
}

export async function getStripePaymentMethod(stripePaymentMethodId: string): Promise<Stripe.PaymentMethod> {
	return getStripeClient().paymentMethods.retrieve(stripePaymentMethodId);
}

export async function getStripePaymentIntent(stripePaymentIntentId: string): Promise<Stripe.PaymentIntent> {
	return getStripeClient().paymentIntents.retrieve(stripePaymentIntentId);
}

export async function getStripeCharge(stripeChargeId: string): Promise<Stripe.Charge> {
	return getStripeClient().charges.retrieve(stripeChargeId);
}

export async function getStripeDispute(stripeDisputeId: string): Promise<Stripe.Dispute> {
	return getStripeClient().disputes.retrieve(stripeDisputeId, { expand: ['charge'] });
}

export async function cloudSubscriptionProjection(subscription: Stripe.Subscription): Promise<SubscriptionProjection> {
	const billingStatus = subscription.status;
	if (!isBillingStatus(billingStatus)) {
		throw new Error(`Unsupported Stripe subscription status "${billingStatus}"`);
	}
	const kind = cloudSubscriptionKind(subscription);
	if (kind === 'trial-placeholder') {
		return cloudTrialPlaceholderProjection(subscription, billingStatus);
	}
	const paidItem = cloudPaidProductItem(subscription);
	if (!paidItem) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no cloud plan item`);
	}
	const { item } = paidItem;

	const trialEndsAt = stripeDate(subscription.trial_end);
	const currentPeriodStartsAt = stripeDate(item.current_period_start);
	const currentPeriodEndsAt = stripeDate(item.current_period_end);
	const cancellationEndsAt = stripeDate(subscription.cancel_at);
	const cancellationScheduled =
		billingStatus !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	const hasDefaultPaymentMethod =
		hasSubscriptionDefaultPaymentMethod(subscription) ||
		(await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer)));
	const plan = cloudBillingPlanDefinition(item.price, paidItem);
	const schedule = await cloudSubscriptionScheduleProjection(subscription, item.current_period_end);
	return {
		billingPlan: plan.key,
		billingStatus,
		stripeCustomerId: stripeCustomerId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripeSubscriptionItemId: item.id,
		stripePriceId: item.price.id,
		seatQuantity: paidItem.tier === 'team' ? (item.quantity ?? null) : null,
		...schedule,
		trialStartedAt: stripeDate(subscription.trial_start),
		trialEndsAt,
		currentPeriodStartsAt,
		currentPeriodEndsAt,
		cancellationScheduled,
		hasDefaultPaymentMethod,
		billingAccessEndsAt: cancellationScheduled
			? (cancellationEndsAt ?? (billingStatus === 'trialing' ? trialEndsAt : currentPeriodEndsAt))
			: billingStatus === 'trialing'
				? trialEndsAt
				: ['active', 'past_due'].includes(billingStatus)
					? currentPeriodEndsAt
					: null,
	};
}

async function cloudTrialPlaceholderProjection(
	subscription: Stripe.Subscription,
	billingStatus: BillingStatus,
): Promise<SubscriptionProjection> {
	const item = cloudTrialPlaceholderItem(subscription);
	if (!item) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no trial placeholder item`);
	}
	const trialEndsAt = stripeDate(subscription.trial_end);
	const cancellationEndsAt = stripeDate(subscription.cancel_at);
	const cancellationScheduled =
		billingStatus !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	const billingAccessEndsAt =
		billingStatus === 'trialing' ? earlierStripeDate(trialEndsAt, cancellationEndsAt) : null;
	const hasDefaultPaymentMethod = await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer));
	return {
		billingPlan: null,
		billingStatus,
		stripeCustomerId: stripeCustomerId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripeSubscriptionItemId: null,
		stripePriceId: item.price.id,
		seatQuantity: null,
		stripeSubscriptionScheduleId: null,
		pendingBillingPlan: null,
		pendingSeatQuantity: null,
		trialStartedAt: stripeDate(subscription.trial_start),
		trialEndsAt,
		currentPeriodStartsAt: stripeDate(item.current_period_start),
		currentPeriodEndsAt: stripeDate(item.current_period_end),
		cancellationScheduled,
		hasDefaultPaymentMethod,
		billingAccessEndsAt,
	};
}

async function cloudSubscriptionScheduleProjection(
	subscription: Stripe.Subscription,
	currentPeriodEnd: number,
): Promise<
	Pick<SubscriptionProjection, 'pendingBillingPlan' | 'pendingSeatQuantity' | 'stripeSubscriptionScheduleId'>
> {
	if (!subscription.schedule) {
		return emptyCloudSubscriptionScheduleProjection();
	}
	const schedule = await expandedSubscriptionSchedule(subscription.schedule);
	if (['canceled', 'completed', 'released'].includes(schedule.status)) {
		return emptyCloudSubscriptionScheduleProjection();
	}
	const pendingPhase = schedule.phases.find((phase) => phase.start_date >= currentPeriodEnd);
	if (!pendingPhase) {
		return {
			stripeSubscriptionScheduleId: schedule.id,
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
		};
	}
	const pendingItem = cloudPaidSchedulePhaseItem(schedule, pendingPhase);
	if (!pendingItem) {
		return {
			stripeSubscriptionScheduleId: schedule.id,
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
		};
	}
	const plan = cloudBillingPlanDefinition(pendingItem.price, pendingItem);
	return {
		stripeSubscriptionScheduleId: schedule.id,
		pendingBillingPlan: plan.key,
		pendingSeatQuantity: pendingItem.tier === 'team' ? (pendingItem.quantity ?? null) : null,
	};
}

function emptyCloudSubscriptionScheduleProjection(): Pick<
	SubscriptionProjection,
	'pendingBillingPlan' | 'pendingSeatQuantity' | 'stripeSubscriptionScheduleId'
> {
	return {
		stripeSubscriptionScheduleId: null,
		pendingBillingPlan: null,
		pendingSeatQuantity: null,
	};
}

async function expandedSubscriptionSchedule(
	schedule: string | Stripe.SubscriptionSchedule,
): Promise<Stripe.SubscriptionSchedule> {
	if (typeof schedule !== 'string' && hasExpandedSchedulePrices(schedule)) {
		return schedule;
	}
	const scheduleId = typeof schedule === 'string' ? schedule : schedule.id;
	return getStripeClient().subscriptionSchedules.retrieve(scheduleId, {
		expand: ['phases.items.price.product'],
	});
}

function hasExpandedSchedulePrices(schedule: Stripe.SubscriptionSchedule): boolean {
	return schedule.phases.every((phase) => phase.items.every((item) => typeof item.price !== 'string'));
}

function cloudPaidSchedulePhaseItem(
	schedule: Stripe.SubscriptionSchedule,
	phase: Stripe.SubscriptionSchedule.Phase,
):
	| (Stripe.SubscriptionSchedule.Phase.Item &
			Pick<CloudPaidProductItem, 'legacy' | 'tier'> & {
				price: CloudRecurringPriceDetails;
			})
	| null {
	const paidItems = phase.items.flatMap((item) => {
		if (typeof item.price === 'string' || item.price.deleted) {
			return [];
		}
		const product = cloudPaidProductForPrice(item.price);
		return product ? [{ ...item, ...product, price: item.price }] : [];
	});
	const productIds = new Set(paidItems.map(({ price }) => stripeProductId(price.product)));
	if (productIds.size > 1) {
		throw new Error(`Stripe Subscription Schedule "${schedule.id}" mixes paid cloud Products`);
	}
	const paidItem = paidItems[0];
	if (!paidItem) {
		return null;
	}
	if (!isCloudRecurringPriceDetails(paidItem.price)) {
		throw new Error(`Stripe Subscription Schedule "${schedule.id}" has an invalid paid cloud Price`);
	}
	return { ...paidItem, price: paidItem.price };
}

export async function validateCloudBillingConfiguration(): Promise<void> {
	await Promise.all([
		...Object.keys(CLOUD_BILLING_PLANS).map((planKey) => getCloudPrice(planKey as CloudBillingPlanKey)),
		...(!isCloudFreeTierEnabled() ? [getAvailableLegacyCloudPrices()] : []),
		getCloudTrialPrice(),
	]);
	const taxSettings = await getStripeClient().tax.settings.retrieve();
	if (taxSettings.status !== 'active') {
		const missingFields = taxSettings.status_details.pending?.missing_fields?.join(', ');
		throw new Error(`Stripe Tax must be active${missingFields ? `; missing: ${missingFields}` : ''}`);
	}
}

export async function getCloudPrice(planKey: CloudBillingPlanKey): Promise<CloudPrice> {
	const plan = CLOUD_BILLING_PLANS[planKey];
	const { lookupKeyVariable, productId, unitAmount } = currentCloudPriceConfiguration(plan);
	const lookupKey = env[lookupKeyVariable];
	if (!lookupKey) {
		throw new Error(`${lookupKeyVariable} is required when cloud billing is enabled`);
	}
	const cached = cloudPriceCache.get(planKey);

	if (cached?.lookupKey === lookupKey && cached.productId === productId && cached.expiresAt > Date.now()) {
		return cached.price;
	}

	const price = fetchCloudPrice(lookupKey, productId, plan, unitAmount);
	cloudPriceCache.set(planKey, {
		lookupKey,
		productId,
		expiresAt: Date.now() + CLOUD_PRICE_CACHE_TTL_MS,
		price,
	});
	try {
		return await price;
	} catch (error) {
		if (cloudPriceCache.get(planKey)?.price === price) {
			cloudPriceCache.delete(planKey);
		}
		throw error;
	}
}

export async function getCurrentCloudBillingPlans(currency: CloudBillingCurrency) {
	return Promise.all(
		(Object.keys(CLOUD_BILLING_PLANS) as CloudBillingPlanKey[]).map(async (planKey) => {
			const plan = CLOUD_BILLING_PLANS[planKey];
			const price = await getCloudPrice(planKey);
			const unitAmount = cloudPriceAmount(price, currency);
			if (unitAmount === null) {
				throw new Error(`Stripe Price "${price.id}" does not support ${currency.toUpperCase()}`);
			}
			return {
				planKey,
				tier: plan.tier,
				interval: plan.interval === 'month' ? ('monthly' as const) : ('yearly' as const),
				currency,
				unitAmount,
				perSeat: plan.perSeat,
			};
		}),
	);
}

async function getLegacyCloudPrice(billingInterval: CloudBillingInterval): Promise<CloudPrice> {
	const plan = legacyCloudBillingPlanDefinition(billingInterval);
	const lookupKeyVariable =
		billingInterval === 'monthly'
			? 'STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY'
			: 'STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY';
	const lookupKey = env[lookupKeyVariable];
	if (!lookupKey) {
		throw new Error(`${lookupKeyVariable} is required when cloud billing is enabled`);
	}
	const productId = configuredCloudPaidProductIds().legacyUnlimited;
	const cached = cloudPriceCache.get(plan.key);
	if (cached?.lookupKey === lookupKey && cached.productId === productId && cached.expiresAt > Date.now()) {
		return cached.price;
	}

	const price = fetchLegacyCloudPrice(lookupKey, productId, plan);
	cloudPriceCache.set(plan.key, {
		lookupKey,
		productId,
		expiresAt: Date.now() + CLOUD_PRICE_CACHE_TTL_MS,
		price,
	});
	try {
		return await price;
	} catch (error) {
		if (cloudPriceCache.get(plan.key)?.price === price) {
			cloudPriceCache.delete(plan.key);
		}
		throw error;
	}
}

async function getCloudTrialPrice(): Promise<CloudTrialPrice> {
	const lookupKey = env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY;
	if (!lookupKey) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY is required when cloud billing is enabled');
	}
	const productId = configuredCloudTrialProductId();
	if (Object.values(configuredCloudPaidProductIds()).includes(productId)) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRODUCT_ID must differ from all paid cloud Product ids');
	}
	if (
		cloudTrialPriceCache?.lookupKey === lookupKey &&
		cloudTrialPriceCache.productId === productId &&
		cloudTrialPriceCache.expiresAt > Date.now()
	) {
		return cloudTrialPriceCache.price;
	}

	const price = fetchCloudTrialPrice(lookupKey, productId);
	cloudTrialPriceCache = {
		lookupKey,
		productId,
		expiresAt: Date.now() + CLOUD_PRICE_CACHE_TTL_MS,
		price,
	};
	try {
		return await price;
	} catch (error) {
		if (cloudTrialPriceCache?.price === price) {
			cloudTrialPriceCache = undefined;
		}
		throw error;
	}
}

async function fetchCloudTrialPrice(lookupKey: string, productId: string): Promise<CloudTrialPrice> {
	const [price] = (
		await getStripeClient().prices.list({
			active: true,
			expand: ['data.product'],
			lookup_keys: [lookupKey],
			limit: 1,
		})
	).data;

	if (!price) {
		throw new Error(`No active Stripe Price found for lookup key "${lookupKey}"`);
	}
	if (!isExpectedCloudTrialPrice(price) || price.product.id !== productId) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to configured active trial Product "${productId}" and be a fixed $0 recurring licensed Price`,
		);
	}
	return price;
}

async function fetchCloudPrice(
	lookupKey: string,
	productId: string,
	plan: CurrentCloudBillingPlanDefinition,
	unitAmount: number,
): Promise<CloudPrice> {
	const [price] = (
		await getStripeClient().prices.list({
			active: true,
			expand: ['data.currency_options', 'data.product'],
			lookup_keys: [lookupKey],
			limit: 1,
		})
	).data;

	if (!price) {
		throw new Error(`No active Stripe Price found for lookup key "${lookupKey}"`);
	}
	if (!isExpectedCloudPrice(price, plan, unitAmount) || price.product.id !== productId) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to configured active Product "${productId}" and be a fixed USD ${unitAmount} and EUR ${unitAmount} ${plan.interval}ly licensed Price`,
		);
	}

	return price;
}

async function fetchLegacyCloudPrice(
	lookupKey: string,
	productId: string,
	plan: LegacyCloudBillingPlanDefinition,
): Promise<CloudPrice> {
	const [price] = (
		await getStripeClient().prices.list({
			active: true,
			expand: ['data.currency_options', 'data.product'],
			lookup_keys: [lookupKey],
			limit: 1,
		})
	).data;
	if (!price) {
		throw new Error(`No active Stripe Price found for lookup key "${lookupKey}"`);
	}
	if (!isExpectedLegacyCloudPrice(price, plan) || price.product.id !== productId) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to configured active legacy Product "${productId}" and be a fixed positive USD and EUR ${plan.interval}ly licensed Price`,
		);
	}
	return price;
}

export function __resetStripeForTesting(): void {
	stripeClient = undefined;
	cloudPriceCache.clear();
	cloudTrialPriceCache = undefined;
	subscriptionCurrencyCache.clear();
	priceCurrencyOptionsCache.clear();
}

export async function getCloudBillingPlans(
	stripePriceId?: string | null,
	currency: CloudBillingCurrency = 'usd',
	subscriptionCurrency?: string | null,
): Promise<{
	availablePlans: Record<CloudBillingInterval, CloudBillingPlan>;
	subscriptionPlan: CloudBillingPlan | null;
}> {
	const { monthly: monthlyPrice, yearly: yearlyPrice } = await getAvailableLegacyCloudPrices();
	const monthlyPlan = LEGACY_CLOUD_BILLING_PLANS.cloud_monthly_v2;
	const yearlyPlan = LEGACY_CLOUD_BILLING_PLANS.cloud_yearly_v1;
	const availablePlans = {
		monthly: cloudBillingPlan(monthlyPrice, monthlyPlan, currency),
		yearly: cloudBillingPlan(yearlyPrice, yearlyPlan, currency),
	};
	if (!stripePriceId) {
		return { availablePlans, subscriptionPlan: null };
	}
	const currentCurrency = subscriptionCurrency ?? currency;
	if (stripePriceId === monthlyPrice.id) {
		return { availablePlans, subscriptionPlan: cloudBillingPlan(monthlyPrice, monthlyPlan, currentCurrency) };
	}
	if (stripePriceId === yearlyPrice.id) {
		return { availablePlans, subscriptionPlan: cloudBillingPlan(yearlyPrice, yearlyPlan, currentCurrency) };
	}

	const subscriptionPrice = await getStripeClient().prices.retrieve(stripePriceId, {
		expand: ['currency_options'],
	});
	const paidProduct = cloudPaidProductForPrice(subscriptionPrice);
	if (!isCloudRecurringPriceDetails(subscriptionPrice) || !paidProduct) {
		throw new Error(`Stripe Price "${stripePriceId}" is not a valid historical cloud Price`);
	}
	const plan = cloudBillingPlanDefinition(subscriptionPrice, paidProduct);
	return {
		availablePlans,
		subscriptionPlan: cloudBillingPlan(subscriptionPrice, plan, subscriptionCurrency ?? subscriptionPrice.currency),
	};
}

export function getStripeClient(): Stripe {
	if (!isCloudBillingEnabled()) {
		throw new Error('Stripe is unavailable because cloud billing is disabled');
	}

	if (!env.STRIPE_SECRET_KEY) {
		throw new Error('STRIPE_SECRET_KEY is required when cloud billing is enabled');
	}

	stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY, {
		apiVersion: STRIPE_API_VERSION,
		maxNetworkRetries: 2,
		timeout: 20_000,
	});

	return stripeClient;
}

function billingPageUrl(): string {
	return new URL('/settings/organization/billing', env.BETTER_AUTH_URL).toString();
}

function checkoutTrialMessage(trialEnd: Date): string {
	const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(trialEnd);
	return `Nothing is charged today. Your recurring price, including any promotion code discount, starts when your trial ends on ${date}.`;
}

function checkoutTrialDaysMessage(trialDays: number): string {
	return `Nothing is charged today. Your ${trialDays}-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.`;
}

function checkoutImmediateStartMessage(): string {
	return 'Not enough time remains to preserve your free trial in Checkout, so your subscription starts when you confirm. The recurring price shown, including any promotion code discount, is charged today.';
}

function stripeTimestamp(date: Date): number {
	return Math.floor(date.getTime() / 1_000);
}

async function reuseOrExpireOpenCheckoutSessions(
	input: {
		organizationId: string;
		stripeCustomerId: string;
		kind: 'initial' | 'resubscribe';
	},
	matches: (session: Stripe.Checkout.Session) => boolean,
): Promise<Stripe.Checkout.Session | undefined> {
	let reusableSession: Stripe.Checkout.Session | undefined;
	const supersededSessions: Stripe.Checkout.Session[] = [];
	for await (const session of getStripeClient().checkout.sessions.list({
		customer: input.stripeCustomerId,
		status: 'open',
		limit: 100,
	})) {
		if (!isOrganizationCheckoutSession(session, input)) {
			continue;
		}
		if (!reusableSession && matches(session)) {
			reusableSession = session;
		} else {
			supersededSessions.push(session);
		}
	}
	for (const session of supersededSessions) {
		await expireSupersededCheckoutSession(session, input.kind);
	}
	return reusableSession;
}

function isOrganizationCheckoutSession(
	session: Stripe.Checkout.Session,
	input: {
		organizationId: string;
		kind: 'initial' | 'resubscribe';
	},
): boolean {
	return (
		session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
		session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind &&
		(isCloudBillingPlanKey(session.metadata?.[PLAN_METADATA_KEY]) ||
			isLegacyCloudBillingPlanKey(session.metadata?.[PLAN_METADATA_KEY]))
	);
}

async function expireSupersededCheckoutSession(
	session: Stripe.Checkout.Session,
	kind: 'initial' | 'resubscribe',
): Promise<void> {
	try {
		await getStripeClient().checkout.sessions.expire(session.id);
	} catch (error) {
		let currentSession: Stripe.Checkout.Session;
		try {
			currentSession = await getStripeClient().checkout.sessions.retrieve(session.id);
		} catch {
			throw error;
		}
		if (currentSession.status === 'expired') {
			return;
		}
		if (currentSession.status === 'complete') {
			const message = 'A Stripe Checkout completed while the billing interval was changing';
			throw kind === 'initial'
				? new CloudInitialCheckoutUnavailableError(message)
				: new CloudSubscriptionUnavailableError(message);
		}
		throw error;
	}
}

async function getAvailableLegacyCloudPrices(): Promise<Record<CloudBillingInterval, CloudPrice>> {
	const [monthly, yearly] = await Promise.all([getLegacyCloudPrice('monthly'), getLegacyCloudPrice('yearly')]);
	return { monthly, yearly };
}

async function findCheckoutSession(
	stripeCustomerId: string,
	status: 'open' | 'expired',
	matches: (session: Stripe.Checkout.Session) => boolean,
): Promise<Stripe.Checkout.Session | undefined> {
	for await (const session of getStripeClient().checkout.sessions.list({
		customer: stripeCustomerId,
		status,
		limit: 100,
	})) {
		if (matches(session)) {
			return session;
		}
	}
	return undefined;
}

function isCreditTopUpInvoice(invoice: Pick<Stripe.Invoice, 'metadata'>): boolean {
	return invoice.metadata?.[CHECKOUT_KIND_METADATA_KEY] === CREDIT_TOP_UP_CHECKOUT_KIND;
}

function invoicePromotionCodes(invoice: Pick<Stripe.Invoice, 'discounts'>): string[] {
	return invoice.discounts.flatMap((discount) => {
		if (
			typeof discount === 'string' ||
			discount.promotion_code === null ||
			typeof discount.promotion_code !== 'object'
		) {
			return [];
		}
		return [discount.promotion_code.code];
	});
}

function cloudPaidProductItem(subscription: Stripe.Subscription): CloudPaidProductItem | null {
	const paidItems = subscription.items.data.flatMap((item) => {
		const product = cloudPaidProductForPrice(item.price);
		return product ? [{ item, ...product }] : [];
	});
	const productIds = new Set(paidItems.map(({ item }) => stripeProductId(item.price.product)));
	if (productIds.size > 1) {
		throw new Error(`Stripe Subscription "${subscription.id}" mixes paid cloud Products`);
	}
	if (
		paidItems.length > 0 &&
		subscription.items.data.some((item) => stripeProductId(item.price.product) === configuredCloudTrialProductId())
	) {
		throw new Error(`Stripe Subscription "${subscription.id}" mixes paid and trial placeholder Products`);
	}
	const paidItem = paidItems[0];
	if (!paidItem) {
		return null;
	}
	if (!isCloudRecurringPriceDetails(paidItem.item.price)) {
		throw new Error(`Stripe Subscription "${subscription.id}" has an invalid paid cloud Price`);
	}
	const classifiedItem = { ...paidItem, item: paidItem.item as CloudSubscriptionItem };
	if (!findCloudBillingPlanDefinition(classifiedItem.item.price, classifiedItem)) {
		throw new Error(`Stripe Price "${classifiedItem.item.price.id}" is not configured for its paid cloud Product`);
	}
	return classifiedItem;
}

function cloudPaidProductForPrice(price: Stripe.Price): Pick<CloudPaidProductItem, 'tier' | 'legacy'> | null {
	const productId = stripeProductId(price.product);
	const productIds = configuredCloudPaidProductIds();
	if (productId === productIds.team) {
		return { tier: 'team', legacy: false };
	}
	if (productId === productIds.unlimited) {
		return { tier: 'unlimited', legacy: false };
	}
	if (productId === productIds.legacyUnlimited) {
		return { tier: 'unlimited', legacy: true };
	}
	return null;
}

function cloudTrialPlaceholderItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
	const productId = configuredCloudTrialProductId();
	const lookupKey = configuredCloudTrialPriceLookupKey();
	return (
		subscription.items.data.find(
			(item) =>
				item.price.lookup_key === lookupKey &&
				stripeProductId(item.price.product) === productId &&
				item.price.type === 'recurring' &&
				item.price.unit_amount === 0,
		) ?? null
	);
}

function configuredCloudPaidProductIds(): {
	team: string;
	unlimited: string;
	legacyUnlimited: string;
} {
	if (
		!env.STRIPE_CLOUD_TEAM_PRODUCT_ID ||
		!env.STRIPE_CLOUD_UNLIMITED_PRODUCT_ID ||
		!env.STRIPE_CLOUD_LEGACY_PRODUCT_ID
	) {
		throw new Error('All paid cloud Product ids are required when cloud billing is enabled');
	}
	return {
		team: env.STRIPE_CLOUD_TEAM_PRODUCT_ID,
		unlimited: env.STRIPE_CLOUD_UNLIMITED_PRODUCT_ID,
		legacyUnlimited: env.STRIPE_CLOUD_LEGACY_PRODUCT_ID,
	};
}

function configuredCloudTrialProductId(): string {
	if (!env.STRIPE_CLOUD_TRIAL_PRODUCT_ID) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRODUCT_ID is required when cloud billing is enabled');
	}
	return env.STRIPE_CLOUD_TRIAL_PRODUCT_ID;
}

function configuredCloudTrialPriceLookupKey(): string {
	if (!env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY is required when cloud billing is enabled');
	}
	return env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY;
}

function assertCloudSubscriptionOrganization(subscription: Stripe.Subscription, organizationId: string): void {
	const metadataOrganizationId = subscription.metadata[ORGANIZATION_METADATA_KEY];
	if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
		throw new Error(`Stripe Subscription "${subscription.id}" organization metadata does not match`);
	}
}

function requireCloudPaidProductItem(subscription: Stripe.Subscription): CloudPaidProductItem {
	const paidItem = cloudPaidProductItem(subscription);
	if (!paidItem) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no cloud plan item`);
	}
	return paidItem;
}

function assertCloudBillingCurrency(currency: string): CloudBillingCurrency {
	if (!(CLOUD_BILLING_CURRENCIES as readonly string[]).includes(currency)) {
		throw new Error(`Stripe returned unsupported billing currency "${currency}"`);
	}
	return currency as CloudBillingCurrency;
}

function copyCloudSchedulePhase(phase: Stripe.SubscriptionSchedule.Phase, startDate: number, endDate: number) {
	return {
		start_date: startDate,
		end_date: endDate,
		items: phase.items.map((item) => ({
			price: typeof item.price === 'string' ? item.price : item.price.id,
			quantity: item.quantity ?? 1,
			...(item.metadata ? { metadata: item.metadata } : {}),
			...(item.tax_rates ? { tax_rates: item.tax_rates.map(stripeId) } : {}),
			...(item.billing_thresholds?.usage_gte
				? { billing_thresholds: { usage_gte: item.billing_thresholds.usage_gte } }
				: {}),
			...(item.discounts?.length > 0 ? { discounts: item.discounts.map(copyCloudScheduleDiscount) } : {}),
		})),
		proration_behavior: phase.proration_behavior,
		...(phase.automatic_tax
			? {
					automatic_tax: {
						enabled: phase.automatic_tax.enabled,
						...(phase.automatic_tax.liability
							? {
									liability: {
										type: phase.automatic_tax.liability.type,
										...(phase.automatic_tax.liability.account
											? { account: stripeId(phase.automatic_tax.liability.account) }
											: {}),
									},
								}
							: {}),
					},
				}
			: {}),
		...(phase.billing_cycle_anchor ? { billing_cycle_anchor: phase.billing_cycle_anchor } : {}),
		...(phase.billing_thresholds
			? {
					billing_thresholds: {
						...(phase.billing_thresholds.amount_gte === null
							? {}
							: { amount_gte: phase.billing_thresholds.amount_gte }),
						...(phase.billing_thresholds.reset_billing_cycle_anchor === null
							? {}
							: { reset_billing_cycle_anchor: phase.billing_thresholds.reset_billing_cycle_anchor }),
					},
				}
			: {}),
		...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
		...(phase.default_payment_method ? { default_payment_method: stripeId(phase.default_payment_method) } : {}),
		...(phase.default_tax_rates ? { default_tax_rates: phase.default_tax_rates.map(stripeId) } : {}),
		...(phase.description ? { description: phase.description } : {}),
		...(phase.discounts?.length > 0 ? { discounts: phase.discounts.map(copyCloudScheduleDiscount) } : {}),
		...(phase.invoice_settings
			? { invoice_settings: copyCloudScheduleInvoiceSettings(phase.invoice_settings) }
			: {}),
		...(phase.metadata ? { metadata: phase.metadata } : {}),
		...(phase.on_behalf_of ? { on_behalf_of: stripeId(phase.on_behalf_of) } : {}),
		...(phase.transfer_data
			? {
					transfer_data: {
						amount_percent: phase.transfer_data.amount_percent ?? undefined,
						destination: stripeId(phase.transfer_data.destination),
					},
				}
			: {}),
		...(phase.trial_end ? { trial_end: phase.trial_end } : {}),
	};
}

function copyCloudScheduleInvoiceSettings(settings: Stripe.SubscriptionSchedule.Phase.InvoiceSettings) {
	return {
		...(settings.account_tax_ids ? { account_tax_ids: settings.account_tax_ids.map(stripeId) } : {}),
		...(settings.custom_fields ? { custom_fields: settings.custom_fields } : {}),
		...(settings.days_until_due === null ? {} : { days_until_due: settings.days_until_due }),
		...(settings.description === null ? {} : { description: settings.description }),
		...(settings.footer === null ? {} : { footer: settings.footer }),
		...(settings.issuer
			? {
					issuer: {
						type: settings.issuer.type,
						...(settings.issuer.account ? { account: stripeId(settings.issuer.account) } : {}),
					},
				}
			: {}),
	};
}

function copyCloudScheduleDiscount(discount: Stripe.SubscriptionSchedule.Phase.Discount) {
	if (discount.discount) {
		return { discount: stripeId(discount.discount) };
	}
	if (discount.promotion_code) {
		return { promotion_code: stripeId(discount.promotion_code) };
	}
	if (discount.coupon) {
		return { coupon: stripeId(discount.coupon) };
	}
	throw new Error('Stripe Subscription Schedule contains an invalid discount');
}

function stripeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
	return typeof customer === 'string' ? customer : customer.id;
}

function stripeId(value: string | { id: string }): string {
	return typeof value === 'string' ? value : value.id;
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
	return typeof product === 'string' ? product : product.id;
}

function hasSubscriptionDefaultPaymentMethod(subscription: Stripe.Subscription): boolean {
	return Boolean(subscription.default_payment_method || subscription.default_source);
}

function stripeDate(value: number | null): Date | null {
	return value === null ? null : new Date(value * 1000);
}

function earlierStripeDate(first: Date | null, second: Date | null): Date | null {
	if (!first) {
		return second;
	}
	return second && second < first ? second : first;
}

function isBillingStatus(status: string): status is BillingStatus {
	return (BILLING_STATUSES as readonly string[]).includes(status);
}

function isExpectedCloudPrice(
	price: Stripe.Price,
	plan: CurrentCloudBillingPlanDefinition,
	unitAmount: number,
): price is CloudPrice {
	const { lookupKeyVariable } = currentCloudPriceConfiguration(plan);
	return (
		price.active &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		isCloudRecurringPriceDetails(price) &&
		price.currency === 'usd' &&
		price.unit_amount === unitAmount &&
		price.currency_options?.eur?.unit_amount === unitAmount &&
		price.lookup_key === env[lookupKeyVariable] &&
		price.recurring.interval === plan.interval &&
		price.recurring.interval_count === plan.intervalCount
	);
}

function isExpectedLegacyCloudPrice(price: Stripe.Price, plan: LegacyCloudBillingPlanDefinition): price is CloudPrice {
	return (
		price.active &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		isCloudRecurringPriceDetails(price) &&
		price.recurring.interval === plan.interval &&
		price.recurring.interval_count === plan.intervalCount &&
		CLOUD_BILLING_CURRENCIES.every((currency) => cloudPriceAmount(price, currency) !== null)
	);
}

function isExpectedCloudTrialPrice(price: Stripe.Price): price is CloudTrialPrice {
	return (
		price.active &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		price.billing_scheme === 'per_unit' &&
		price.unit_amount === 0 &&
		price.type === 'recurring' &&
		price.recurring?.usage_type === 'licensed'
	);
}

function isCloudRecurringPriceDetails(price: Stripe.Price): price is CloudRecurringPriceDetails {
	return (
		price.billing_scheme === 'per_unit' &&
		typeof price.unit_amount === 'number' &&
		price.unit_amount > 0 &&
		price.type === 'recurring' &&
		price.recurring?.usage_type === 'licensed'
	);
}

function cloudBillingPlanDefinition(
	price: CloudRecurringPriceDetails,
	product: Pick<CloudPaidProductItem, 'tier' | 'legacy'>,
): CloudBillingPlanDefinition {
	const plan = findCloudBillingPlanDefinition(price, product);
	if (!plan) {
		throw new Error(`Stripe Price "${price.id}" is not configured for its paid cloud Product`);
	}
	return plan;
}

function findCloudBillingPlanDefinition(
	price: Stripe.Price,
	product: Pick<CloudPaidProductItem, 'tier' | 'legacy'>,
): CloudBillingPlanDefinition | undefined {
	const recurring = price.recurring;
	if (!recurring) {
		return undefined;
	}
	if (product.legacy) {
		return Object.values(LEGACY_CLOUD_BILLING_PLANS).find(
			(plan) => plan.interval === recurring.interval && plan.intervalCount === recurring.interval_count,
		);
	}
	const interval = cloudBillingInterval(recurring);
	if (!interval) {
		return undefined;
	}
	const plan = getCloudBillingPlanDefinition(product.tier, interval);
	const { lookupKeyVariable } = currentCloudPriceConfiguration(plan);
	return price.lookup_key === env[lookupKeyVariable] ? plan : undefined;
}

function cloudBillingPlan(
	price: CloudRecurringPriceDetails,
	plan: CloudBillingPlanDefinition,
	currency: string,
): CloudBillingPlan {
	const amount = cloudPriceAmount(price, currency);
	if (amount === null) {
		throw new Error(`Stripe Price "${price.id}" does not support ${currency.toUpperCase()}`);
	}
	return {
		...plan,
		amount,
		currency,
	};
}

function cloudBillingInterval(recurring: Stripe.Price.Recurring): CloudBillingInterval | null {
	if (recurring.interval_count !== 1) {
		return null;
	}
	if (recurring.interval === 'month') {
		return 'monthly';
	}
	return recurring.interval === 'year' ? 'yearly' : null;
}

function legacyCloudBillingPlanDefinition(billingInterval: CloudBillingInterval): LegacyCloudBillingPlanDefinition {
	return billingInterval === 'monthly'
		? LEGACY_CLOUD_BILLING_PLANS.cloud_monthly_v2
		: LEGACY_CLOUD_BILLING_PLANS.cloud_yearly_v1;
}

function requireCloudBillingInterval(interval: CloudBillingInterval | undefined): CloudBillingInterval {
	if (!interval) {
		throw new Error('A cloud billing interval is required for legacy Checkout');
	}
	return interval;
}

function currentCloudPriceConfiguration(plan: CurrentCloudBillingPlanDefinition): {
	lookupKeyVariable:
		| 'STRIPE_CLOUD_TEAM_MONTHLY_PRICE_LOOKUP_KEY'
		| 'STRIPE_CLOUD_TEAM_YEARLY_PRICE_LOOKUP_KEY'
		| 'STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY'
		| 'STRIPE_CLOUD_UNLIMITED_YEARLY_PRICE_LOOKUP_KEY';
	productId: string;
	unitAmount: number;
} {
	const productIds = configuredCloudPaidProductIds();
	switch (plan.key) {
		case 'cloud_team_monthly_v1':
			return {
				lookupKeyVariable: 'STRIPE_CLOUD_TEAM_MONTHLY_PRICE_LOOKUP_KEY',
				productId: productIds.team,
				unitAmount: 5_000,
			};
		case 'cloud_team_yearly_v1':
			return {
				lookupKeyVariable: 'STRIPE_CLOUD_TEAM_YEARLY_PRICE_LOOKUP_KEY',
				productId: productIds.team,
				unitAmount: 50_000,
			};
		case 'cloud_unlimited_monthly_v1':
			return {
				lookupKeyVariable: 'STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY',
				productId: productIds.unlimited,
				unitAmount: 200_000,
			};
		case 'cloud_unlimited_yearly_v1':
			return {
				lookupKeyVariable: 'STRIPE_CLOUD_UNLIMITED_YEARLY_PRICE_LOOKUP_KEY',
				productId: productIds.unlimited,
				unitAmount: 2_000_000,
			};
	}
}

function cloudPriceAmount(price: CloudRecurringPriceDetails, currency: string): number | null {
	const amount = price.currency === currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
	return typeof amount === 'number' && amount > 0 ? amount : null;
}

async function monthlyRecurringAmount(subscription: Stripe.Subscription, item: CloudSubscriptionItem): Promise<number> {
	const unitAmount = await subscriptionUnitAmount(item.price, subscription.currency);
	const amount = applyRecurringDiscounts(unitAmount * (item.quantity ?? 1), subscription);
	const months = (item.price.recurring.interval === 'year' ? 12 : 1) * item.price.recurring.interval_count;
	return Math.round(amount / months);
}

async function subscriptionUnitAmount(price: CloudRecurringPriceDetails, currency: string): Promise<number> {
	if (price.currency === currency) {
		return price.unit_amount;
	}
	const priceWithCurrencyOptions = await getPriceWithCurrencyOptions(price.id);
	return priceWithCurrencyOptions.currency_options?.[currency]?.unit_amount ?? 0;
}

function getPriceWithCurrencyOptions(priceId: string): Promise<Stripe.Price> {
	const cached = priceCurrencyOptionsCache.get(priceId);
	if (cached) {
		return cached;
	}
	const price = getStripeClient().prices.retrieve(priceId, { expand: ['currency_options'] });
	priceCurrencyOptionsCache.set(priceId, price);
	price.catch(() => priceCurrencyOptionsCache.delete(priceId));
	return price;
}

function applyRecurringDiscounts(amount: number, subscription: Stripe.Subscription): number {
	const now = Date.now() / 1_000;
	return subscription.discounts.reduce((discounted, discount) => {
		if (typeof discount === 'string' || (discount.end !== null && discount.end <= now)) {
			return discounted;
		}
		const coupon = discount.source.coupon;
		if (!coupon || typeof coupon === 'string' || coupon.duration === 'once') {
			return discounted;
		}
		if (coupon.percent_off !== null) {
			return discounted * (1 - coupon.percent_off / 100);
		}
		const amountOff =
			coupon.currency === subscription.currency
				? coupon.amount_off
				: coupon.currency_options?.[subscription.currency]?.amount_off;
		return Math.max(0, discounted - (amountOff ?? 0));
	}, amount);
}
