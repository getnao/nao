import { format as d3Format, formatSpecifier } from 'd3-format';

import type { ValueFormat } from './tools/display-chart';

export const CHART_NUMBER_LOCALE = 'en-US';

const COMPACT_UNITS = [
	{ value: 1_000_000_000_000, suffix: 'T' },
	{ value: 1_000_000_000, suffix: 'B' },
	{ value: 1_000_000, suffix: 'M' },
	{ value: 1_000, suffix: 'K' },
] as const;

export function formatCompactNumber(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 10_000) {
		return formatCompactUnit(value, 1);
	}
	return value.toLocaleString(CHART_NUMBER_LOCALE);
}

export function formatCompactUnit(value: number, fractionDigits: number): string {
	const abs = Math.abs(value);
	let unitIndex = COMPACT_UNITS.findIndex((unit) => abs >= unit.value);
	if (unitIndex === -1) {
		return String(Number(value.toFixed(fractionDigits)));
	}

	let unit = COMPACT_UNITS[unitIndex];
	let scaledValue = Number((value / unit.value).toFixed(fractionDigits));
	if (Math.abs(scaledValue) >= 1_000 && unitIndex > 0) {
		unitIndex -= 1;
		unit = COMPACT_UNITS[unitIndex];
		scaledValue = Number((value / unit.value).toFixed(fractionDigits));
	}
	return `${scaledValue}${unit.suffix}`;
}

export function formatChartValue(value: number, valueFormat?: ValueFormat, opts?: { compact?: boolean }): string {
	const formatted = formatWithD3(value, valueFormat);
	const body = formatted ?? (opts?.compact ? formatCompactNumber(value) : value.toLocaleString(CHART_NUMBER_LOCALE));
	return attachValueAffixes(body, valueFormat);
}

export function attachValueAffixes(value: string, valueFormat?: ValueFormat): string {
	const hasNegativeSign = value.startsWith('-') || value.startsWith('−');
	const body = hasNegativeSign ? value.slice(1) : value;
	const sign = hasNegativeSign ? '-' : '';
	return `${sign}${valueFormat?.prefix ?? ''}${body}${valueFormat?.suffix ?? ''}`;
}

export function getChartLevelValueFormat(
	series: { is_total?: boolean; value_format?: ValueFormat }[],
): ValueFormat | undefined {
	const formats = series.filter((item) => !item.is_total).map((item) => item.value_format);
	const firstFormat = formats[0];
	const allShareFormat = formats.every(
		(format) =>
			format?.d3_format === firstFormat?.d3_format &&
			format?.compact === firstFormat?.compact &&
			format?.prefix === firstFormat?.prefix &&
			format?.suffix === firstFormat?.suffix,
	);
	return allShareFormat ? firstFormat : undefined;
}

export function niceAxisMax(dataMax: number, tickCount = 5): number {
	if (dataMax <= 0) {
		return 0;
	}
	const roughStep = dataMax / (tickCount - 1);
	const magnitude = 10 ** Math.floor(Math.log10(roughStep));
	const normalized = roughStep / magnitude;
	const niceNormalized =
		normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
	const niceStep = niceNormalized * magnitude;
	return niceStep * Math.ceil(dataMax / niceStep);
}

export function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function formatWithD3(value: number, valueFormat?: ValueFormat): string | null {
	if (!valueFormat?.d3_format) {
		return null;
	}
	try {
		const specifier = formatSpecifier(valueFormat.d3_format);
		const formatted = d3Format(valueFormat.d3_format)(value);
		if (specifier.type !== 's' || valueFormat.compact === 'si') {
			return formatted;
		}
		return formatted.replace(/k$/, 'K').replace(/G$/, 'B');
	} catch {
		return null;
	}
}
