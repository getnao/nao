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

export function getBrowserBillingCurrency(): CloudBillingCurrency {
	return getBillingCurrencyForLocales(browserLocales());
}

export function getBillingCurrencyForLocales(locales: readonly unknown[]): CloudBillingCurrency {
	for (const locale of locales) {
		const region = localeRegion(locale);
		if (region) {
			return EURO_AREA_REGIONS.has(region) ? 'eur' : 'usd';
		}
	}
	return 'usd';
}

function browserLocales(): unknown[] {
	const locales: unknown[] = [];
	const preferredLanguages = safelyRead(() => navigator.languages);
	if (Array.isArray(preferredLanguages)) {
		locales.push(...preferredLanguages);
	}
	locales.push(
		safelyRead(() => navigator.language),
		safelyRead(() => new Intl.DateTimeFormat().resolvedOptions().locale),
	);
	return locales;
}

function safelyRead<T>(read: () => T): T | undefined {
	try {
		return read();
	} catch {
		return undefined;
	}
}

function localeRegion(locale: unknown): string | null {
	if (typeof locale !== 'string') {
		return null;
	}
	const normalizedLocale = locale
		.trim()
		.replace(/[.@].*$/, '')
		.replaceAll('_', '-');
	if (!normalizedLocale) {
		return null;
	}
	try {
		return new Intl.Locale(normalizedLocale).maximize().region?.toUpperCase() ?? null;
	} catch {
		return null;
	}
}
