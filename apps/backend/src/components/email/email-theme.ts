import type { CSSProperties } from 'react';

export const emailColors = {
	foreground: '#1f1f23',
	muted: '#73737a',
	brand: '#522bff',
};

export const emailFontsUrl =
	'https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono&display=swap';

export const emailFonts = {
	sans: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
	mono: "'Geist Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

export const emailText: Record<'body' | 'muted', CSSProperties> = {
	body: {
		margin: '0 0 20px',
		fontFamily: emailFonts.sans,
		fontSize: '16px',
		lineHeight: '26px',
		color: emailColors.foreground,
	},
	muted: {
		margin: '0 0 12px',
		fontFamily: emailFonts.sans,
		fontSize: '13px',
		lineHeight: '20px',
		color: emailColors.muted,
	},
};
