type BillingStatusView = {
	label: string;
	description: string;
	variant: 'success' | 'secondary' | 'destructive' | 'outline';
};

export function getBillingStatusView(
	status: string | null,
	cancellationScheduled: boolean,
	hasDefaultPaymentMethod: boolean,
): BillingStatusView {
	switch (status) {
		case 'trialing':
			return {
				label: 'Free trial',
				description: cancellationScheduled
					? 'Your trial is scheduled to end without renewal.'
					: hasDefaultPaymentMethod
						? 'Your free trial is active. Your payment method will be charged when it ends.'
						: 'Your free trial is active. Subscribe before it ends to continue.',
				variant: 'secondary',
			};
		case 'active':
			return {
				label: cancellationScheduled ? 'Active · not renewing' : 'Active',
				description: cancellationScheduled
					? 'Your plan remains active until the end of the current billing period.'
					: 'Your subscription is active and renews automatically.',
				variant: cancellationScheduled ? 'secondary' : 'success',
			};
		case 'past_due':
			return {
				label: 'Payment past due',
				description: 'A payment failed and Stripe is retrying it. Update your payment details to keep access.',
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
				? 'Your payment method is ready. Resuming starts a new billing period and charges it immediately.'
				: 'Add a payment method in Stripe, then return here to resume. Resuming starts a new billing period and charges it immediately.';
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

export function formatBillingPrice(amount: number, currency: string): string {
	const normalizedCurrency = currency.toUpperCase();
	const { maximumFractionDigits: minorUnitDigits = 2 } = new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: normalizedCurrency,
	}).resolvedOptions();
	const minorUnitDivisor = 10 ** minorUnitDigits;
	const fractionDigits = amount % minorUnitDivisor === 0 ? 0 : minorUnitDigits;
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: normalizedCurrency,
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(amount / minorUnitDivisor);
}

export function formatBillingInterval(interval: string, intervalCount: number): string {
	return intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
}

export function formatBillingStatus(status: string | null): string {
	return status
		? status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
		: 'Not configured';
}

export function formatInvoiceLabel(date: Date): string {
	return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

export function formatBillingDate(date: Date | null): string {
	return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : '—';
}
