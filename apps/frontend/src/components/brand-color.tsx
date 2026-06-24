/* @license Enterprise */

import { useEffect } from 'react';

import { useRouterState } from '@tanstack/react-router';

import { useBranding } from '@/hooks/use-branding';

const AUTH_PATHS = new Set(['/login', '/signup', '/forgot-password', '/reset-password', '/consent']);
const STYLE_ID = 'nao-brand-color';

/** HSL lightness above this is considered "too light" for a light-mode background. */
const LIGHT_THRESHOLD_L = 60;
/** Target lightness for the darkened primary in light mode (visible but not too aggressive). */
const PRIMARY_L_CAP = 42;
/** Max lightness for the gradient end in light mode (lighter than primary, not washed out). */
const GRAD_END_L_CAP = 62;

/** HSL lightness below this is considered "too dark" for a dark-mode background. */
const DARK_THRESHOLD_L = 40;
/** Target lightness for the lightened primary in dark mode (visible but not too aggressive). */
const PRIMARY_L_FLOOR = 58;
/** Min lightness for the gradient end in dark mode (lighter than primary, not washed out). */
const GRAD_END_L_FLOOR = 78;

export function BrandColor() {
	const branding = useBranding();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		const shouldApply = branding.enabled && branding.brandColor && !AUTH_PATHS.has(pathname);
		if (!shouldApply) {
			removeBrandStyle();
			return;
		}
		injectBrandStyle(branding.brandColor!);
		return () => removeBrandStyle();
	}, [branding.enabled, branding.brandColor, pathname]);

	return null;
}

export function buildBrandVars(hex: string, theme: 'light' | 'dark' = 'light'): Record<string, string> {
	return buildThemeVars(hex, theme);
}

function injectBrandStyle(hex: string) {
	removeBrandStyle();
	const style = document.createElement('style');
	style.id = STYLE_ID;
	const lightVars = buildThemeVars(hex, 'light');
	const darkVars = buildThemeVars(hex, 'dark');
	style.textContent = toCssBlock(':root', lightVars) + '\n' + toCssBlock('.dark', darkVars);
	document.head.appendChild(style);
}

function removeBrandStyle() {
	document.getElementById(STYLE_ID)?.remove();
}

function toCssBlock(selector: string, vars: Record<string, string>): string {
	const body = Object.entries(vars)
		.map(([k, v]) => `  ${k}: ${v};`)
		.join('\n');
	return `${selector} {\n${body}\n}`;
}

function buildThemeVars(hex: string, theme: 'light' | 'dark'): Record<string, string> {
	const [h, s, l] = hexToHsl(hex);

	let primary: string;
	let gradStart: string;
	let gradEnd: string;

	if (isLightColor(hex)) {
		gradStart = hslToHex(h, s, Math.min(l, PRIMARY_L_CAP));
		gradEnd = hslToHex(h, s, Math.min(l, GRAD_END_L_CAP));
		primary = theme === 'light' ? gradStart : hex;
	} else if (isDarkColor(hex)) {
		gradStart = hslToHex(h, s, Math.max(l, PRIMARY_L_FLOOR));
		gradEnd = hslToHex(h, s, Math.max(l, GRAD_END_L_FLOOR));
		primary = theme === 'dark' ? gradStart : hex;
		gradStart = hex;
		gradEnd = lighten(hex, 15);
	} else {
		primary = hex;
		gradStart = hex;
		gradEnd = lighten(hex, 15);
	}

	const gradHoverStart = lighten(gradStart, 8);
	const gradHoverEnd = lighten(gradEnd, 8);
	const gradDark = darken(gradStart, 20);
	const gradLight = lighten(gradEnd, 25);

	const [ph, ps, pl] = hexToHsl(primary);
	const muted = hslToHex(ph, Math.max(ps - 20, 0), clamp(pl + 25, 0, 95));
	const fg = chooseForeground(primary);

	return {
		'--primary': primary,
		'--primary-muted': muted,
		'--primary-foreground': fg,
		'--violet': primary,
		'--gradient-brand': `linear-gradient(180deg, ${gradStart} 0%, ${gradEnd} 100%)`,
		'--gradient-brand-hover': `linear-gradient(180deg, ${gradHoverStart} 0%, ${gradHoverEnd} 100%)`,
		'--gradient-brand-border': `linear-gradient(180deg, ${gradStart} 0%, ${gradDark} 50.48%, ${gradLight} 100%)`,
		'--gradient-brand-foreground': fg,
	};
}

function isLightColor(hex: string): boolean {
	const [, , l] = hexToHsl(hex);
	return l > LIGHT_THRESHOLD_L;
}

function isDarkColor(hex: string): boolean {
	const [, , l] = hexToHsl(hex);
	return l < DARK_THRESHOLD_L;
}

function chooseForeground(bgHex: string): string {
	const bgLum = relativeLuminance(bgHex);
	const darkFgLum = 0.04;
	const whiteContrast = (1 + 0.05) / (bgLum + 0.05);
	const darkContrast = (bgLum + 0.05) / (darkFgLum + 0.05);
	return whiteContrast >= darkContrast ? '#ffffff' : 'oklch(0.21 0.008 270)';
}

function relativeLuminance(hex: string): number {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const toLinear = (c: number) => {
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function lighten(hex: string, amount: number): string {
	const [h, s, l] = hexToHsl(hex);
	return hslToHex(h, s, clamp(l + amount, 0, 100));
}

function darken(hex: string, amount: number): string {
	return lighten(hex, -amount);
}

function hexToHsl(hex: string): [number, number, number] {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) {
		return [0, 0, Math.round(l * 100)];
	}
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	switch (max) {
		case r:
			h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
			break;
		case g:
			h = ((b - r) / d + 2) / 6;
			break;
		case b:
			h = ((r - g) / d + 4) / 6;
			break;
	}
	return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
	const ls = l / 100;
	const ss = s / 100;
	const a = ss * Math.min(ls, 1 - ls);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = ls - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(n: number, min: number, max: number) {
	return Math.min(Math.max(n, min), max);
}
