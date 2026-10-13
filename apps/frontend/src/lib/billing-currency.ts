import type { CloudBillingCurrency } from '@nao/shared/billing';

const EURO_AREA_REGIONS = new Set([
	'AT',
	'BE',
	'BG',
	'CY',
	'DE',
	'EE',
	'ES',
	'FI',
	'FR',
	'GR',
	'HR',
	'IE',
	'IT',
	'LT',
	'LU',
	'LV',
	'MT',
	'NL',
	'PT',
	'SI',
	'SK',
]);

export function getBillingCurrencyForLocale(locale: string): CloudBillingCurrency {
	try {
		const region = new Intl.Locale(locale).maximize().region;
		return region && EURO_AREA_REGIONS.has(region) ? 'eur' : 'usd';
	} catch {
		return 'usd';
	}
}
