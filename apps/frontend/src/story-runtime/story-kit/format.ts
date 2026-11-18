import { CHART_NUMBER_LOCALE, formatChartValue, toFiniteNumber } from '@nao/shared/chart-values';
import type { displayChart } from '@nao/shared/tools';

export type ValueFormat = 'number' | 'compact' | 'percent' | 'currency';

export interface FormatOptions {
	format?: ValueFormat;
	currency?: string;
	decimals?: number;
}

/** Also used as a Recharts `formatter`, which passes numerics through as strings when the driver returned them so. */
export function formatNumber(value: unknown, options: FormatOptions = {}): string {
	const number = toFiniteNumber(value);
	if (number === null) {
		return typeof value === 'string' && value !== '' ? value : '—';
	}
	return formatChartValue(number, toChartValueFormat(options));
}

/** Maps the kit's format shorthand onto the value format classic charts use, so both render numbers alike. */
export function toChartValueFormat({ format, currency = 'USD', decimals }: FormatOptions = {}):
	| displayChart.ValueFormat
	| undefined {
	if (format === undefined && decimals === undefined) {
		return undefined;
	}
	switch (format) {
		case 'compact':
			return { d3_format: '.3~s', compact: 'financial' };
		case 'percent':
			return { d3_format: `.${decimals ?? 1}~%` };
		case 'currency':
			return { d3_format: `,.${decimals ?? 0}f`, prefix: currencySymbol(currency) };
		default:
			return { d3_format: `,.${decimals ?? 2}~f` };
	}
}

function currencySymbol(currency: string): string {
	try {
		const parts = new Intl.NumberFormat(CHART_NUMBER_LOCALE, { style: 'currency', currency }).formatToParts(0);
		return parts.find((part) => part.type === 'currency')?.value ?? `${currency} `;
	} catch {
		return `${currency} `;
	}
}
