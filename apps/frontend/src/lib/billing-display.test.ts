import { describe, expect, it } from 'vitest';

import { formatBillingPrice } from './billing-display';

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
