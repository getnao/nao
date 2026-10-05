/* @license Enterprise */

import { useRouterState } from '@tanstack/react-router';
import { formatHex, hsl, wcagContrast, wcagLuminance } from 'culori';
import { useEffect } from 'react';

import { useBranding } from '@/hooks/use-branding';

const AUTH_PATHS = new Set(['/login', '/signup', '/forgot-password', '/reset-password', '/consent']);
const STYLE_ID = 'nao-brand-color';
const DARK_FOREGROUND = 'oklch(0.21 0.008 270)';
/** Kept as the nominal value the light/dark tipping point was tuned against. */
const DARK_FOREGROUND_LUMINANCE = 0.04;

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

export function buildLastUsedPillVars(hex: string): Record<string, string> {
	return {
		'--last-used-pill-bg': hex,
		'--last-used-pill-fg': chooseForeground(hex),
	};
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
	const whiteContrast = wcagContrast('#ffffff', bgHex);
	const darkContrast = (wcagLuminance(bgHex) + 0.05) / (DARK_FOREGROUND_LUMINANCE + 0.05);
	return whiteContrast >= darkContrast ? '#ffffff' : DARK_FOREGROUND;
}

function lighten(hex: string, amount: number): string {
	const [h, s, l] = hexToHsl(hex);
	return hslToHex(h, s, clamp(l + amount, 0, 100));
}

function darken(hex: string, amount: number): string {
	return lighten(hex, -amount);
}

/** Hue in degrees, saturation and lightness as percentages. */
function hexToHsl(hex: string): [number, number, number] {
	const { h = 0, s, l } = hsl(hex) ?? { s: 0, l: 0 };
	return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
	return formatHex({ mode: 'hsl', h, s: s / 100, l: l / 100 });
}

function clamp(n: number, min: number, max: number) {
	return Math.min(Math.max(n, min), max);
}
