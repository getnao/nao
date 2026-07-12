/**
 * Conditional formatting model for table columns.
 *
 * Rules are intentionally a discriminated union so new kinds (e.g. a
 * `formula` rule) can be added later without breaking existing consumers.
 */

export interface ColorScaleRule {
	type: 'color-scale';
	minColor?: string;
	maxColor?: string;
	/** Optional explicit domain; falls back to the column's own min/max. */
	min?: number;
	max?: number;
}

export type ThresholdOperator = '>=' | '>' | '<=' | '<' | '=';

export interface ThresholdRule {
	type: 'threshold';
	operator: ThresholdOperator;
	value: number;
	color: string;
}

export type ConditionalFormatRule = ColorScaleRule | ThresholdRule;

export type ColumnConditionalFormats = Record<string, ConditionalFormatRule>;

export interface ColumnRange {
	min: number;
	max: number;
}

export const DEFAULT_SCALE_MIN_COLOR = 'rgba(59, 130, 246, 0.04)';
export const DEFAULT_SCALE_MAX_COLOR = 'rgba(59, 130, 246, 0.55)';
export const DEFAULT_THRESHOLD_COLOR = 'rgba(34, 197, 94, 0.32)';

const THRESHOLD_OPERATORS: readonly ThresholdOperator[] = ['>=', '>', '<=', '<', '='];

export function isConditionalFormatRule(value: unknown): value is ConditionalFormatRule {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const rule = value as Record<string, unknown>;
	if (rule.type === 'color-scale') {
		return (
			isOptionalString(rule.minColor) &&
			isOptionalString(rule.maxColor) &&
			isOptionalFiniteNumber(rule.min) &&
			isOptionalFiniteNumber(rule.max)
		);
	}
	if (rule.type === 'threshold') {
		return (
			THRESHOLD_OPERATORS.includes(rule.operator as ThresholdOperator) &&
			typeof rule.value === 'number' &&
			Number.isFinite(rule.value) &&
			typeof rule.color === 'string'
		);
	}
	return false;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): boolean {
	return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Keeps only well-formed rules from untrusted input (e.g. LLM-supplied
 * formatting), so malformed entries are skipped instead of crashing render.
 */
export function sanitizeConditionalFormats(input: unknown): ColumnConditionalFormats | undefined {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return undefined;
	}

	const result: ColumnConditionalFormats = {};
	for (const [column, rule] of Object.entries(input as Record<string, unknown>)) {
		if (isConditionalFormatRule(rule)) {
			result[column] = rule;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

export function computeColumnRange(rows: Record<string, unknown>[], column: string): ColumnRange | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;

	for (const row of rows) {
		const value = row[column];
		if (typeof value === 'number' && Number.isFinite(value)) {
			if (value < min) {
				min = value;
			}
			if (value > max) {
				max = value;
			}
		}
	}

	return min === Number.POSITIVE_INFINITY ? null : { min, max };
}

export function resolveCellBackground(
	rule: ConditionalFormatRule,
	value: unknown,
	range: ColumnRange | null,
): string | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}

	if (rule.type === 'threshold') {
		return matchesThreshold(rule, value) ? rule.color : undefined;
	}

	return resolveColorScale(rule, value, range);
}

function matchesThreshold(rule: ThresholdRule, value: number): boolean {
	switch (rule.operator) {
		case '>=':
			return value >= rule.value;
		case '>':
			return value > rule.value;
		case '<=':
			return value <= rule.value;
		case '<':
			return value < rule.value;
		case '=':
			return value === rule.value;
	}
}

function resolveColorScale(rule: ColorScaleRule, value: number, range: ColumnRange | null): string | undefined {
	const min = rule.min ?? range?.min;
	const max = rule.max ?? range?.max;
	if (min === undefined || max === undefined) {
		return undefined;
	}

	const ratio = max === min ? 1 : clamp01((value - min) / (max - min));
	return interpolateColor(rule.minColor ?? DEFAULT_SCALE_MIN_COLOR, rule.maxColor ?? DEFAULT_SCALE_MAX_COLOR, ratio);
}

interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

function interpolateColor(from: string, to: string, ratio: number): string | undefined {
	const start = parseColor(from);
	const end = parseColor(to);
	if (!start || !end) {
		return undefined;
	}

	const r = Math.round(start.r + (end.r - start.r) * ratio);
	const g = Math.round(start.g + (end.g - start.g) * ratio);
	const b = Math.round(start.b + (end.b - start.b) * ratio);
	const a = roundAlpha(start.a + (end.a - start.a) * ratio);
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function parseColor(input: string): Rgba | null {
	const value = input.trim();

	if (value.startsWith('#')) {
		return parseHexColor(value);
	}

	const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
	if (rgbMatch) {
		const parts = rgbMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
		if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
			return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
		}
	}

	return null;
}

function parseHexColor(value: string): Rgba | null {
	let hex = value.slice(1);
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((char) => char + char)
			.join('');
	}
	if ((hex.length !== 6 && hex.length !== 8) || !/^[0-9a-fA-F]+$/.test(hex)) {
		return null;
	}

	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16),
		a: hex.length === 8 ? roundAlpha(Number.parseInt(hex.slice(6, 8), 16) / 255) : 1,
	};
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function roundAlpha(value: number): number {
	return Math.round(clamp01(value) * 100) / 100;
}
