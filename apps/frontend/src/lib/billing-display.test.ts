import { describe, expect, it } from 'vitest';

import { formatBillingPrice } from './billing-display';

describe('formatBillingPrice', () => {
	it.each([
		{ amount: 200_000, currency: 'eur', majorAmount: 2_000, fractionDigits: 0 },
		{ amount: 199_999, currency: 'eur', majorAmount: 1_999.99, fractionDigits: 2 },
		{ amount: 1_999, currency: 'jpy', majorAmount: 1_999, fractionDigits: 0 },
		{ amount: 1_999, currency: 'kwd', majorAmount: 1.999, fractionDigits: 3 },
	])('formats $currency amounts in the currency minor unit', ({ amount, currency, majorAmount, fractionDigits }) => {
		expect(formatBillingPrice(amount, currency)).toBe(
			new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: currency.toUpperCase(),
				minimumFractionDigits: fractionDigits,
				maximumFractionDigits: fractionDigits,
			}).format(majorAmount),
		);
	});
});
