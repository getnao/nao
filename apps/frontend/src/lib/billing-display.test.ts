import { describe, expect, it } from 'vitest';

import { formatBillingPrice, getBillingStatusView } from './billing-display';

describe('formatBillingPrice', () => {
	it.each([
		{ amount: 200_000, currency: 'usd', majorAmount: 2_000, fractionDigits: 0 },
		{ amount: 199_999, currency: 'eur', majorAmount: 1_999.99, fractionDigits: 2 },
	])('uses locale-aware formatting for $currency', ({ amount, currency, majorAmount, fractionDigits }) => {
		const expected = new Intl.NumberFormat(undefined, {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
			style: 'currency',
			currency: currency.toUpperCase(),
		}).format(majorAmount);

		expect(formatBillingPrice(amount, currency)).toBe(expected);
	});
});

it.each([
	{
		hasPaidPlan: false,
		label: 'Free trial ended',
		description: 'Your free trial has ended. Subscribe to restore access.',
	},
	{
		hasPaidPlan: true,
		label: 'Canceled',
		description: 'Your previous subscription is canceled and kept as billing history. It cannot be resumed.',
	},
])('describes a canceled subscription when hasPaidPlan=$hasPaidPlan', ({ hasPaidPlan, label, description }) => {
	const cancellationScheduled = false;
	const hasDefaultPaymentMethod = false;

	expect(getBillingStatusView('canceled', cancellationScheduled, hasDefaultPaymentMethod, hasPaidPlan)).toEqual({
		label,
		description,
		variant: 'outline',
	});
});
