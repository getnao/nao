import { formatHex } from 'culori';
import type { Rgb } from 'culori';

const SENTINEL = '#010203';

export function resolveCssColor(value: string): Rgb | null {
	if (typeof document === 'undefined') {
		return null;
	}
	const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!context) {
		return null;
	}
	context.fillStyle = SENTINEL;
	context.fillStyle = value;
	if (context.fillStyle === SENTINEL && value.toLowerCase() !== SENTINEL) {
		return null;
	}
	context.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
	return { mode: 'rgb', r: r / 255, g: g / 255, b: b / 255, alpha: a / 255 };
}

export function resolveCssVariableColor(variableName: string, element?: HTMLElement | null): Rgb | null {
	if (typeof document === 'undefined') {
		return null;
	}
	const value = getComputedStyle(element ?? document.documentElement)
		.getPropertyValue(variableName)
		.trim();
	return value ? resolveCssColor(value) : null;
}

export function resolveCssVariableColorHex(
	variableName: string,
	fallback: string,
	element?: HTMLElement | null,
): string {
	const color = resolveCssVariableColor(variableName, element);
	return color ? formatHex(color) : fallback;
}
