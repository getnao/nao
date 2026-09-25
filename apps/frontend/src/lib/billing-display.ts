const STRIPE_CHECKOUT_MIN_TRIAL_MS = 48 * 60 * 60 * 1000;

type BillingStatusView = {
	label: string;
	description: string;
	variant: 'success' | 'secondary' | 'destructive' | 'outline';
};

export function preservesRemainingTrial(trialEndsAt: Date | null, now = Date.now()): boolean {
	return trialEndsAt !== null && trialEndsAt.getTime() >= now + STRIPE_CHECKOUT_MIN_TRIAL_MS;
}

export function getBillingStatusView(
	status: string | null,
	cancelAtPeriodEnd: boolean,
	hasDefaultPaymentMethod: boolean,
	isLocalTrialExpired: boolean,
	isLocalTrialPending: boolean,
): BillingStatusView {
	switch (status) {
		case 'trialing':
			if (isLocalTrialPending) {
				return {
					label: 'Trial setup incomplete',
					description: 'Complete Stripe Checkout before the free trial and access begin.',
					variant: 'outline',
				};
			}
			if (isLocalTrialExpired) {
				return {
					label: 'Trial ended',
					description: 'Your free trial has ended. Subscribe to restore access.',
					variant: 'outline',
				};
			}
			return {
				label: 'Free trial',
				description: cancelAtPeriodEnd
					? 'Your trial is scheduled to end without renewal.'
					: hasDefaultPaymentMethod
						? 'Your free trial is active. Your payment method will be charged when it ends.'
						: 'Your free trial is active. Subscribe before it ends to continue.',
				variant: 'secondary',
			};
		case 'active':
			return {
				label: cancelAtPeriodEnd ? 'Active · not renewing' : 'Active',
				description: cancelAtPeriodEnd
					? 'Your plan remains active until the end of the current billing period.'
					: 'Your subscription is active and renews automatically.',
				variant: cancelAtPeriodEnd ? 'secondary' : 'success',
			};
		case 'past_due':
			return {
				label: 'Payment past due',
				description: 'A payment failed. Update your payment details to avoid losing access.',
				variant: 'destructive',
			};
		case 'unpaid':
			return {
				label: 'Unpaid',
				description: 'Payment retries have stopped. Update your billing details in Stripe.',
				variant: 'destructive',
			};
		case 'paused':
			return {
				label: 'Paused',
				description: 'Your trial ended without a payment method. Add one, then resume the subscription.',
				variant: 'secondary',
			};
		case 'incomplete':
			return {
				label: 'Setup incomplete',
				description: 'Subscription setup still needs payment confirmation.',
				variant: 'destructive',
			};
		case 'incomplete_expired':
			return {
				label: 'Setup expired',
				description: 'The unfinished subscription expired and is kept as billing history.',
				variant: 'outline',
			};
		case 'canceled':
			return {
				label: 'Canceled',
				description:
					'Your previous subscription is canceled and kept as billing history. It cannot be resumed.',
				variant: 'outline',
			};
		default:
			return {
				label: 'Not started',
				description: 'No subscription has been started.',
				variant: 'outline',
			};
	}
}

export function getBillingManagementDescription(status: string | null, hasDefaultPaymentMethod: boolean): string {
	switch (status) {
		case 'paused':
			return hasDefaultPaymentMethod
				? 'Your payment method is ready. Resume your subscription to restore billing.'
				: 'Add a payment method in Stripe, then return here to resume your subscription.';
		case 'past_due':
		case 'unpaid':
		case 'incomplete':
			return 'Update your payment details and resolve the outstanding payment in Stripe.';
		case 'canceled':
		case 'incomplete_expired':
			return 'This subscription is historical and cannot be resumed. Start a new subscription or review its billing records.';
		default:
			return 'Add payment details, view invoices, or manage your subscription with Stripe.';
	}
}

export function getBillingPortalButtonLabel(status: string | null): string {
	return isHistoricalBillingStatus(status) ? 'Open billing history' : 'Manage subscription';
}

export function isHistoricalBillingStatus(status: string | null | undefined): boolean {
	return status === 'canceled' || status === 'incomplete_expired';
}

export function formatBillingRenewal(status: string | null, cancelAtPeriodEnd: boolean): string {
	if (cancelAtPeriodEnd && status !== 'canceled') {
		return 'Will not renew';
	}
	switch (status) {
		case 'trialing':
			return 'Starts after trial';
		case 'active':
		case 'past_due':
			return 'Renews automatically';
		case 'paused':
			return 'Paused';
		case 'canceled':
			return 'Ended';
		case 'unpaid':
			return 'Payment stopped';
		case 'incomplete':
			return 'Pending setup';
		case 'incomplete_expired':
			return 'Expired';
		default:
			return '—';
	}
}

export function formatBillingPrice(amount: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: currency.toUpperCase(),
		maximumFractionDigits: 0,
	}).format(amount / 100);
}

export function formatBillingInterval(interval: string, intervalCount: number): string {
	return intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
}

export function formatBillingStatus(status: string | null): string {
	return status
		? status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
		: 'Not configured';
}

export function formatBillingDate(date: Date | null): string {
	return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : '—';
}
