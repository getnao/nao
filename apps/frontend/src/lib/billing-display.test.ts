import { describe, expect, it } from 'vitest';

import { formatBillingPrice } from './billing-display';

describe('formatBillingPrice', () => {
	it.each([
		{ amount: 200_000, currency: 'eur', majorAmount: 2_000, fractionDigits: 0 },
		{ amount: 199_999, currency: 'eur', majorAmount: 1_999.99, fractionDigits: 2 },
		{ amount: 1_999, currency: 'jpy', majorAmount: 1_999, fractionDigits: 0 },
		{ amount: 1_999, currency: 'kwd', majorAmount: 1.999, fractionDigits: 3 },
	])('formats $currency amounts in the currency minor unit', ({ amount, currency, majorAmount, fractionDigits }) => {
		const options = {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		};
		const expected =
			currency === 'eur'
				? `${new Intl.NumberFormat(undefined, options).format(majorAmount)}€`
				: new Intl.NumberFormat(undefined, {
						...options,
						style: 'currency',
						currency: currency.toUpperCase(),
					}).format(majorAmount);
		expect(formatBillingPrice(amount, currency)).toBe(expected);
	});

	it('places the dollar before and euro after the amount', () => {
		const amount = new Intl.NumberFormat(undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}).format(2_000);

		expect(formatBillingPrice(200_000, 'usd')).toBe(`$${amount}`);
		expect(formatBillingPrice(200_000, 'eur')).toBe(`${amount}€`);
	});
});
