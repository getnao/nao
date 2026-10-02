import { describe, expect, it } from 'vitest';

import { formatBillingPrice } from './billing-display';

describe('formatBillingPrice', () => {
	it('preserves fractional currency amounts', () => {
		expect(formatBillingPrice(199_999, 'eur')).toBe(
			new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: 'EUR',
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(1_999.99),
		);
	});
});
