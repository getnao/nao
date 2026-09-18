import { z } from 'zod';

import { isDarkSurface } from './story-theme-contrast';

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const hexColor = z.string().regex(HEX_COLOR, 'Expected a 6-digit hex colour such as #522bff.');

const fontStack = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.regex(/^[a-zA-Z0-9\s,'"-]+$/, 'Font stack may only contain letters, numbers, spaces, quotes, commas and hyphens.');

export const FONT_STYLESHEET_HOSTS = [
	'fonts.googleapis.com',
	'fonts.gstatic.com',
	'fonts.bunny.net',
	'use.typekit.net',
	'p.typekit.net',
] as const;

export function isAllowedFontStylesheet(raw: string): boolean {
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && FONT_STYLESHEET_HOSTS.some((host) => url.hostname === host);
	} catch {
		return false;
	}
}

export const MIN_CHART_SERIES_COLORS = 3;
export const MAX_CHART_SERIES_COLORS = 11;
export const MAX_FONT_STYLESHEETS = 4;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_ZIP_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_IMAGES = 4;
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

const DEFAULT_SURFACES = { page: '#ffffff', sunken: '#f8f8f8' };
const DEFAULT_ACCENT = { color: '#522bff', ink: '#ffffff' };
const DEFAULT_TEXT = {
	headingColor: '#262626',
	bodyColor: '#4a4a4a',
	mutedColor: '#808080',
	headingFont: "Borna, 'Helvetica Neue', Arial, sans-serif",
	bodyFont: "Geist, 'Helvetica Neue', Arial, sans-serif",
	fontStylesheets: [] as string[],
	headingScale: 1,
	headingTracking: -0.02,
	bodySize: 16,
	lineHeight: 1.6,
};
const DEFAULT_BLOCK = { background: '#ffffff', borderColor: '#e6e6e6', borderWidth: 0, radius: 10 };
const DEFAULT_TABLE = {
	background: '#ffffff',
	headerBackground: '#f8f8f8',
	headerText: '#262626',
	borderColor: '#e6e6e6',
	borderWidth: 1,
	stripedRows: false,
};
const DEFAULT_CHARTS = {
	series: ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00', '#ff6467', '#8b5cf6'],
	grid: '#ebebeb',
	barRadius: 4,
};

export const storySurfacesSchema = z.object({
	/** Page ground behind the story. */
	page: hexColor.default(DEFAULT_SURFACES.page),
	/** Recessed ground: table headers, inactive segments. */
	sunken: hexColor.default(DEFAULT_SURFACES.sunken),
});

export const storyAccentSchema = z.object({
	/** Links, active controls, selected states. */
	color: hexColor.default(DEFAULT_ACCENT.color),
	/** Text placed on the accent colour. */
	ink: hexColor.default(DEFAULT_ACCENT.ink),
});

/** Text blocks render bare on the page, so everything about type lives here. */
export const storyTextSchema = z.object({
	/** Headings and KPI figures. */
	headingColor: hexColor.default(DEFAULT_TEXT.headingColor),
	/** Paragraphs, lists and table cells. */
	bodyColor: hexColor.default(DEFAULT_TEXT.bodyColor),
	/** Axis ticks, captions, helper text. */
	mutedColor: hexColor.default(DEFAULT_TEXT.mutedColor),
	headingFont: fontStack.default(DEFAULT_TEXT.headingFont),
	bodyFont: fontStack.default(DEFAULT_TEXT.bodyFont),
	/** Stylesheets to load so the named faces actually resolve. */
	fontStylesheets: z
		.array(z.string().refine(isAllowedFontStylesheet, 'Font stylesheet host is not allowed.'))
		.max(MAX_FONT_STYLESHEETS)
		.default(DEFAULT_TEXT.fontStylesheets),
	/** Multiplier on heading sizes. */
	headingScale: z.number().min(0.8).max(1.4).default(DEFAULT_TEXT.headingScale),
	/** Letter spacing on headings, in em. */
	headingTracking: z.number().min(-0.06).max(0.06).default(DEFAULT_TEXT.headingTracking),
	/** Paragraph size in px. */
	bodySize: z.number().min(13).max(20).default(DEFAULT_TEXT.bodySize),
	/** Paragraph line height, unitless. */
	lineHeight: z.number().min(1.2).max(2).default(DEFAULT_TEXT.lineHeight),
});

/** KPI, chart and any other framed block; tables and text have their own slots. */
export const storyBlockSchema = z.object({
	background: hexColor.default(DEFAULT_BLOCK.background),
	/** Also used for rules and inputs. */
	borderColor: hexColor.default(DEFAULT_BLOCK.borderColor),
	/** In px; 0 draws no border. */
	borderWidth: z.number().min(0).max(4).default(DEFAULT_BLOCK.borderWidth),
	/** Corner radius in px. */
	radius: z.number().min(0).max(28).default(DEFAULT_BLOCK.radius),
});

/** Tables draw their own frame, so they are styled apart from blocks. */
export const storyTableSchema = z.object({
	background: hexColor.default(DEFAULT_TABLE.background),
	headerBackground: hexColor.default(DEFAULT_TABLE.headerBackground),
	headerText: hexColor.default(DEFAULT_TABLE.headerText),
	/** Frame, header rule and cell dividers. */
	borderColor: hexColor.default(DEFAULT_TABLE.borderColor),
	/** Frame width in px; 0 draws no frame. */
	borderWidth: z.number().min(0).max(4).default(DEFAULT_TABLE.borderWidth),
	stripedRows: z.boolean().default(DEFAULT_TABLE.stripedRows),
});

export const storyChartsSchema = z.object({
	/** Categorical series colours, assigned in order. */
	series: z.array(hexColor).min(MIN_CHART_SERIES_COLORS).max(MAX_CHART_SERIES_COLORS).default(DEFAULT_CHARTS.series),
	/** Grid lines behind every chart. */
	grid: hexColor.default(DEFAULT_CHARTS.grid),
	/** Corner radius on bars, in px. */
	barRadius: z.number().min(0).max(12).default(DEFAULT_CHARTS.barRadius),
});

export const storyThemeSchema = z.object({
	surfaces: storySurfacesSchema.default(DEFAULT_SURFACES),
	accent: storyAccentSchema.default(DEFAULT_ACCENT),
	text: storyTextSchema.default(DEFAULT_TEXT),
	block: storyBlockSchema.default(DEFAULT_BLOCK),
	table: storyTableSchema.default(DEFAULT_TABLE),
	charts: storyChartsSchema.default(DEFAULT_CHARTS),
});

export type StoryTheme = z.infer<typeof storyThemeSchema>;
export type StoryThemeInput = z.input<typeof storyThemeSchema>;

export const DEFAULT_STORY_THEME: StoryTheme = storyThemeSchema.parse({});

export function parseStoredStoryTheme(raw: unknown): StoryTheme | null {
	const value = typeof raw === 'string' ? safeJsonParse(raw) : raw;
	if (value === null || typeof value !== 'object') {
		return null;
	}
	const result = storyThemeSchema.safeParse(value);
	return result.success ? result.data : null;
}

export function sameTheme(a: StoryTheme, b: StoryTheme): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The bridge to the running app: a custom story container gets these as inline
 * CSS custom properties, so nao's components pick the theme up without being
 * rewritten. Names match the tokens already declared in the frontend styles.
 */
export function storyThemeToCssVars(theme: StoryTheme): Record<string, string> {
	const vars: Record<string, string> = {
		'--background': theme.surfaces.page,
		'--panel': theme.surfaces.sunken,
		'--card': theme.block.background,
		'--popover': theme.block.background,
		'--secondary': theme.surfaces.sunken,
		'--muted': theme.surfaces.sunken,
		'--accent': theme.surfaces.sunken,

		'--foreground': theme.text.headingColor,
		'--card-foreground': theme.text.headingColor,
		'--popover-foreground': theme.text.headingColor,
		'--secondary-foreground': theme.text.bodyColor,
		'--accent-foreground': theme.text.headingColor,
		'--muted-foreground': theme.text.mutedColor,
		'--story-body-color': theme.text.bodyColor,
		'--story-body-size': `${theme.text.bodySize}px`,
		'--story-line-height': String(theme.text.lineHeight),

		'--primary': theme.accent.color,
		'--primary-foreground': theme.accent.ink,
		'--ring': theme.accent.color,

		'--border': theme.block.borderColor,
		'--input': theme.block.borderColor,
		'--story-block-border-width': `${theme.block.borderWidth}px`,
		...radiusScale(theme.block.radius),

		'--story-table-bg': theme.table.background,
		'--story-table-header-bg': theme.table.headerBackground,
		'--story-table-header-fg': theme.table.headerText,
		'--story-table-border': theme.table.borderColor,
		'--story-table-border-width': `${theme.table.borderWidth}px`,

		'--font-sans': theme.text.bodyFont,
		'--font-heading': theme.text.headingFont,
		'--story-heading-scale': String(theme.text.headingScale),
		'--story-heading-tracking': `${theme.text.headingTracking}em`,

		'--chart-grid': theme.charts.grid,

		'color-scheme': isDarkSurface(theme.surfaces.page) ? 'dark' : 'light',
	};

	for (let index = 0; index < MAX_CHART_SERIES_COLORS; index++) {
		vars[`--chart-${index + 1}`] = theme.charts.series[index % theme.charts.series.length];
	}
	return vars;
}

function radiusScale(radius: number): Record<string, string> {
	return {
		'--radius': `${radius}px`,
		'--radius-sm': `${Math.max(0, radius - 4)}px`,
		'--radius-md': `${Math.max(0, radius - 2)}px`,
		'--radius-lg': `${radius}px`,
		'--radius-xl': `${radius + 4}px`,
		'--radius-2xl': `${radius + 8}px`,
		'--radius-3xl': `${radius + 12}px`,
		'--radius-4xl': `${radius + 16}px`,
		'--story-block-radius': `${radius}px`,
	};
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
