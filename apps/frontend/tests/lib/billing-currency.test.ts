import { describe, expect, it } from 'vitest';

import { getBillingCurrencyForLocales } from '@/lib/billing-currency';

describe('getBillingCurrencyForLocales', () => {
	it.each(['fr-FR', 'de-DE', 'hr-HR', 'bg-BG', 'en_FR', 'EN-fr', 'en-Latn-FR', 'fr_FR.UTF-8', 'fr_FR@euro'])(
		'uses EUR for euro-area locale %s',
		(locale) => {
			expect(getBillingCurrencyForLocales([locale])).toBe('eur');
		},
	);

	it.each(['pl-PL', 'da-DK', 'sv-SE', 'en-US', 'en-GB', 'ja-JP'])(
		'uses USD outside the euro area for locale %s',
		(locale) => {
			expect(getBillingCurrencyForLocales([locale])).toBe('usd');
		},
	);

	it('infers the likely region for a regionless locale', () => {
		expect(getBillingCurrencyForLocales(['fr'])).toBe('eur');
		expect(getBillingCurrencyForLocales(['en'])).toBe('usd');
	});

	it('skips missing and malformed locale sources', () => {
		expect(getBillingCurrencyForLocales([undefined, null, 42, '', 'not a locale', 'en_FR'])).toBe('eur');
	});

	it('uses the first locale with a valid region', () => {
		expect(getBillingCurrencyForLocales(['en-US', 'fr-FR'])).toBe('usd');
	});

	it('falls back to USD when every locale source is unusable', () => {
		expect(getBillingCurrencyForLocales([undefined, null, '', 'not a locale'])).toBe('usd');
	});
});
