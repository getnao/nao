import { describe, expect, it } from 'vitest';

import { labelize } from '../src/chart-builder';
import { formatDateValue, isIsoDateLike, resolveDateFormatPattern } from '../src/date';
import { formatCellValue } from '../src/story-table-utils';

describe('isIsoDateLike', () => {
	it('returns true for ISO date-only strings', () => {
		expect(isIsoDateLike('2024-03-15')).toBe(true);
	});

	it('returns true for ISO datetimes with explicit timezone', () => {
		expect(isIsoDateLike('2024-03-15T12:30:00Z')).toBe(true);
		expect(isIsoDateLike('2024-03-15T12:30Z')).toBe(true);
		expect(isIsoDateLike('2024-03-15T12:30:00.123Z')).toBe(true);
		expect(isIsoDateLike('2024-03-15T12:30:00+02:00')).toBe(true);
		expect(isIsoDateLike('2024-03-15T12:30:00-05:00')).toBe(true);
	});

	it('rejects naive datetimes without a timezone (avoids day shifts)', () => {
		expect(isIsoDateLike('2024-03-15T12:30:00')).toBe(false);
		expect(isIsoDateLike('2024-03-15T23:59:59.999')).toBe(false);
	});

	it('returns false for trailing garbage after a valid ISO date', () => {
		expect(isIsoDateLike('2024-03-15-extra')).toBe(false);
		expect(isIsoDateLike('2024-03-15T12:30:00Zoops')).toBe(false);
	});

	it('returns false for non-date strings', () => {
		expect(isIsoDateLike('hello')).toBe(false);
		expect(isIsoDateLike('15/03/2024')).toBe(false);
		expect(isIsoDateLike('')).toBe(false);
	});

	it('returns false for non-string inputs', () => {
		expect(isIsoDateLike(20240315)).toBe(false);
		expect(isIsoDateLike(null)).toBe(false);
		expect(isIsoDateLike(undefined)).toBe(false);
	});
});

describe('resolveDateFormatPattern', () => {
	it('defaults to European when no settings are provided', () => {
		expect(resolveDateFormatPattern()).toBe('DD/MM/YYYY');
		expect(resolveDateFormatPattern(null)).toBe('DD/MM/YYYY');
	});

	it('returns preset patterns', () => {
		expect(resolveDateFormatPattern({ preset: 'european' })).toBe('DD/MM/YYYY');
		expect(resolveDateFormatPattern({ preset: 'american' })).toBe('MM/DD/YYYY');
		expect(resolveDateFormatPattern({ preset: 'iso' })).toBe('YYYY-MM-DD');
	});

	it('returns the custom pattern when provided', () => {
		expect(resolveDateFormatPattern({ preset: 'custom', customFormat: 'DD MMM YYYY' })).toBe('DD MMM YYYY');
	});

	it('falls back to European when the custom pattern is missing', () => {
		expect(resolveDateFormatPattern({ preset: 'custom' })).toBe('DD/MM/YYYY');
		expect(resolveDateFormatPattern({ preset: 'custom', customFormat: '   ' })).toBe('DD/MM/YYYY');
	});
});

describe('formatDateValue', () => {
	it('formats ISO dates using the European preset by default', () => {
		expect(formatDateValue('2024-03-15')).toBe('15/03/2024');
	});

	it('formats ISO dates using the American preset', () => {
		expect(formatDateValue('2024-03-15', { preset: 'american' })).toBe('03/15/2024');
	});

	it('formats ISO dates using the ISO preset', () => {
		expect(formatDateValue('2024-03-15', { preset: 'iso' })).toBe('2024-03-15');
	});

	it('formats ISO dates using a custom pattern with month name', () => {
		expect(formatDateValue('2024-03-15', { preset: 'custom', customFormat: 'D MMM YYYY' })).toBe('15 Mar 2024');
		expect(formatDateValue('2024-03-15', { preset: 'custom', customFormat: 'MMMM D, YYYY' })).toBe(
			'March 15, 2024',
		);
	});

	it('supports literal segments wrapped in brackets', () => {
		expect(formatDateValue('2024-03-15', { preset: 'custom', customFormat: '[on] DD/MM/YYYY' })).toBe(
			'on 15/03/2024',
		);
	});

	it('returns the value unchanged when it is not a date', () => {
		expect(formatDateValue('not a date')).toBe('not a date');
		expect(formatDateValue(null)).toBe('');
		expect(formatDateValue(42)).toBe('42');
	});

	it('handles ISO datetimes consistently in UTC', () => {
		expect(formatDateValue('2024-03-15T23:59:59Z', { preset: 'iso' })).toBe('2024-03-15');
	});
});

describe('labelize', () => {
	it('formats ISO dates using the provided preset', () => {
		expect(labelize('2024-03-15', { preset: 'american' })).toBe('03/15/2024');
		expect(labelize('2024-03-15', { preset: 'european' })).toBe('15/03/2024');
	});

	it('falls back to the default European preset when no settings provided', () => {
		expect(labelize('2024-03-15')).toBe('15/03/2024');
	});

	it('humanises non-date strings', () => {
		expect(labelize('product_category')).toBe('Product Category');
	});
});

describe('formatCellValue', () => {
	it('formats ISO date strings with the provided settings', () => {
		expect(formatCellValue('2024-03-15', { preset: 'american' })).toBe('03/15/2024');
	});

	it('passes through other string values unchanged', () => {
		expect(formatCellValue('hello')).toBe('hello');
	});

	it('formats numbers and booleans like before', () => {
		expect(formatCellValue(42)).toBe('42');
		expect(formatCellValue(true)).toBe('TRUE');
		expect(formatCellValue(null)).toBe('NULL');
	});
});
