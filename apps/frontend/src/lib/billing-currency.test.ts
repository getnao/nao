import { describe, expect, it } from 'vitest';

import { getBillingCurrencyForLocale } from './billing-currency';

describe('getBillingCurrencyForLocale', () => {
	it.each(['fr-FR', 'de-DE', 'hr-HR', 'bg-BG'])('uses EUR for euro-area locale %s', (locale) => {
		expect(getBillingCurrencyForLocale(locale)).toBe('eur');
	});

	it.each(['pl-PL', 'da-DK', 'sv-SE'])('uses USD for EU locale %s outside the euro area', (locale) => {
		expect(getBillingCurrencyForLocale(locale)).toBe('usd');
	});

	it.each(['en-US', 'en-GB', 'ja-JP'])('uses USD outside the euro area for locale %s', (locale) => {
		expect(getBillingCurrencyForLocale(locale)).toBe('usd');
	});

	it('infers the likely region for a regionless locale', () => {
		expect(getBillingCurrencyForLocale('fr')).toBe('eur');
		expect(getBillingCurrencyForLocale('en')).toBe('usd');
	});

	it('falls back to USD for an invalid locale', () => {
		expect(getBillingCurrencyForLocale('not_a_locale')).toBe('usd');
	});
});
