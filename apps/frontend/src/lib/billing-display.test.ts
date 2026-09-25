import { describe, expect, it } from 'vitest';

import { formatBillingPrice } from './billing-display';

describe('formatBillingPrice', () => {
	it('preserves fractional currency amounts', () => {
		expect(formatBillingPrice(199_999, 'eur')).not.toBe(formatBillingPrice(200_000, 'eur'));
	});
});
