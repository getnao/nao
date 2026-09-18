/**
 * Conditional formatting model for table columns.
 *
 * Rules are intentionally a discriminated union so new kinds (e.g. a
 * `formula` rule) can be added later without breaking existing consumers.
 */

import { interpolate, type Rgb } from 'culori';

import { cssColorToHex, parseCssColor } from './color';

export interface ColorScaleRule {
	type: 'color-scale';
	/**
	 * Main/base color of the scale. The gradient runs from a light tint of this
	 * color (low) to the color itself (high). Explicit `minColor`/`maxColor`
	 * take precedence when set. Falls back to the default blue scale when absent.
	 */
	color?: string;
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

export interface BooleanRule {
	type: 'boolean';
	/** Background for truthy cells; unset means no background for true. */
	trueColor?: string;
	/** Background for falsy cells; unset means no background for false. */
	falseColor?: string;
}

export type StringOperator = 'equals' | 'in' | 'like';

export interface StringRule {
	type: 'string';
	operator: StringOperator;
	/** A single value for `equals`/`like`, or a list of values for `in`. */
	value: string | string[];
	color: string;
}

export type ConditionalFormatRule = ColorScaleRule | ThresholdRule | BooleanRule | StringRule;

export type ColumnConditionalFormats = Record<string, ConditionalFormatRule>;

export interface ColumnRange {
	min: number;
	max: number;
}

export const DEFAULT_SCALE_MIN_COLOR = 'rgba(59, 130, 246, 0.04)';
export const DEFAULT_SCALE_MAX_COLOR = 'rgba(59, 130, 246, 0.55)';
export const DEFAULT_THRESHOLD_COLOR = 'rgba(34, 197, 94, 0.32)';

/** Alpha applied to the low/high ends when deriving a scale from a single main color. */
const SCALE_MIN_ALPHA = 0.04;
const SCALE_MAX_ALPHA = 0.55;

const THRESHOLD_OPERATORS: readonly ThresholdOperator[] = ['>=', '>', '<=', '<', '='];
const STRING_OPERATORS: readonly StringOperator[] = ['equals', 'in', 'like'];

export function isConditionalFormatRule(value: unknown): value is ConditionalFormatRule {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const rule = value as Record<string, unknown>;
	if (rule.type === 'color-scale') {
		return (
			isOptionalString(rule.color) &&
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
	if (rule.type === 'boolean') {
		return isOptionalString(rule.trueColor) && isOptionalString(rule.falseColor);
	}
	if (rule.type === 'string') {
		if (!STRING_OPERATORS.includes(rule.operator as StringOperator) || typeof rule.color !== 'string') {
			return false;
		}
		return rule.operator === 'in'
			? Array.isArray(rule.value) && rule.value.every((entry) => typeof entry === 'string')
			: typeof rule.value === 'string';
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
	switch (rule.type) {
		case 'color-scale':
			return isFiniteNumber(value) ? resolveColorScale(rule, value, range) : undefined;
		case 'threshold':
			return isFiniteNumber(value) && matchesThreshold(rule, value) ? rule.color : undefined;
		case 'boolean':
			return resolveBoolean(rule, value);
		case 'string':
			return resolveString(rule, value);
	}
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function resolveBoolean(rule: BooleanRule, value: unknown): string | undefined {
	const asBoolean = coerceBoolean(value);
	if (asBoolean === undefined) {
		return undefined;
	}
	return asBoolean ? rule.trueColor : rule.falseColor;
}

/** Normalizes real booleans plus their common string/number representations. */
function coerceBoolean(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		if (value === 1) {
			return true;
		}
		if (value === 0) {
			return false;
		}
		return undefined;
	}
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true' || normalized === 't' || normalized === 'yes' || normalized === '1') {
			return true;
		}
		if (normalized === 'false' || normalized === 'f' || normalized === 'no' || normalized === '0') {
			return false;
		}
	}
	return undefined;
}

function resolveString(rule: StringRule, value: unknown): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	return matchesString(rule, String(value)) ? rule.color : undefined;
}

function matchesString(rule: StringRule, cell: string): boolean {
	switch (rule.operator) {
		case 'equals':
			return typeof rule.value === 'string' && cell === rule.value;
		case 'in':
			return Array.isArray(rule.value) && rule.value.includes(cell);
		case 'like':
			return typeof rule.value === 'string' && cell.toLowerCase().includes(rule.value.toLowerCase());
	}
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
	const { minColor, maxColor } = scaleEndpoints(rule);
	return interpolateColor(minColor, maxColor, ratio);
}

/**
 * Resolves the low/high gradient endpoints independently. For each end: an
 * explicit `minColor`/`maxColor` wins; otherwise the end is derived from the
 * main `color` (low tint / high); otherwise it falls back to the default scale.
 * So `color` + a single explicit endpoint keeps the `color`-derived other end.
 */
function scaleEndpoints(rule: ColorScaleRule): { minColor: string; maxColor: string } {
	const derived = rule.color ? parseCssColor(rule.color) : null;
	return {
		minColor: rule.minColor ?? (derived ? toRgbaString(derived, SCALE_MIN_ALPHA) : DEFAULT_SCALE_MIN_COLOR),
		maxColor: rule.maxColor ?? (derived ? toRgbaString(derived, SCALE_MAX_ALPHA) : DEFAULT_SCALE_MAX_COLOR),
	};
}

/**
 * Converts any CSS color to an opaque `#rrggbb` string for `<input type="color">`.
 * Alpha is dropped since the picker cannot represent it. Returns null when the
 * color cannot be parsed.
 */
export function colorToHex(color: string): string | null {
	return cssColorToHex(color, 0);
}

function interpolateColor(from: string, to: string, ratio: number): string | undefined {
	const start = parseCssColor(from);
	const end = parseCssColor(to);
	if (!start || !end) {
		return undefined;
	}
	return toRgbaString(interpolate([start, end], 'rgb')(ratio));
}

function toRgbaString(color: Rgb, alpha = color.alpha ?? 1): string {
	const channel = (value: number) => Math.round(value * 255);
	return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${roundAlpha(alpha)})`;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function roundAlpha(value: number): number {
	return Math.round(clamp01(value) * 100) / 100;
}
