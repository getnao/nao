import { z } from 'zod';

import { contrastRatio, isDarkSurface, legibleOn, readableInkFor } from './story-theme-contrast';
import {
	DEFAULT_STORY_TYPOGRAPHY,
	seedTypographyFromLegacy,
	storyTypographySchema,
	typographyCssVars,
} from './story-theme-typography';
import { parseStoredJson } from './utils';

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

export const STORY_HEADER_STYLES = ['none', 'logo', 'name', 'band'] as const;
export const STORY_KPI_STYLES = ['plain', 'lead', 'tinted'] as const;
export const STORY_LOGO_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export type StoryLogoMediaType = (typeof STORY_LOGO_MEDIA_TYPES)[number];
export const MAX_STORY_LOGO_BYTES = 512 * 1024;
const MAX_STORY_LOGO_DATA_URI_LENGTH = 64 + Math.ceil(MAX_STORY_LOGO_BYTES / 3) * 4;
const STORY_LOGO_DATA_URI = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

const LEAD_ACCENT_CONTRAST = 3;
const FLAT_BLOCK_STEP = 1.03;
const MIN_FLAT_FRAME_BORDER_WIDTH = 1;
const MIN_HEADER_INK_CONTRAST = 4.5;

export const MIN_CHART_SERIES_COLORS = 3;
export const MAX_CHART_SERIES_COLORS = 11;
export const MAX_FONT_STYLESHEETS = 4;

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
	typography: DEFAULT_STORY_TYPOGRAPHY,
	bodySize: 16,
	lineHeight: 1.6,
};
const DEFAULT_BLOCK = {
	background: '#ffffff',
	borderColor: '#e6e6e6',
	borderWidth: 0,
	radius: 10,
	controlRadius: 8,
	kpiStyle: 'plain' as const,
};
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
const DEFAULT_BRAND = {
	name: '',
	logo: null,
	header: 'none' as const,
	headerBackground: '#ffffff',
	showName: false,
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
const storyTextObjectSchema = z.object({
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
	/** Face, weight, case, slant, tracking and size for each kind of text. */
	typography: storyTypographySchema.default(DEFAULT_TEXT.typography),
	/** Paragraph size in px. */
	bodySize: z.number().min(13).max(20).default(DEFAULT_TEXT.bodySize),
	/** Paragraph line height, unitless. */
	lineHeight: z.number().min(1.2).max(2).default(DEFAULT_TEXT.lineHeight),
});

export const storyTextSchema = z.preprocess(seedTypographyFromLegacy, storyTextObjectSchema);

/** KPI, chart and any other framed block; tables and text have their own slots. */
export const storyBlockSchema = z.object({
	background: hexColor.default(DEFAULT_BLOCK.background),
	/** Also used for rules and inputs. */
	borderColor: hexColor.default(DEFAULT_BLOCK.borderColor),
	/** In px; 0 draws no border. */
	borderWidth: z.number().min(0).max(4).default(DEFAULT_BLOCK.borderWidth),
	/** Corner radius in px. */
	radius: z.number().min(0).max(28).default(DEFAULT_BLOCK.radius),
	/** Corner radius of buttons and filter chips, in px; 999 draws pills. */
	controlRadius: z.number().min(0).max(999).default(DEFAULT_BLOCK.controlRadius),
	/** `lead` inverts the first KPI of a row, `tinted` washes each KPI with a series colour. */
	kpiStyle: z.enum(STORY_KPI_STYLES).default(DEFAULT_BLOCK.kpiStyle),
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

export const storyLogoSchema = z
	.string()
	.max(MAX_STORY_LOGO_DATA_URI_LENGTH, 'The logo is too large.')
	.regex(STORY_LOGO_DATA_URI, 'The logo must be a PNG, JPEG, WebP or SVG image.');

/** The identity a story opens with: a header carrying the logo or the brand name. */
export const storyBrandSchema = z.object({
	name: z.string().trim().max(60).default(DEFAULT_BRAND.name),
	logo: storyLogoSchema.nullable().default(DEFAULT_BRAND.logo),
	/** `band` fills the header with `headerBackground`; `logo` and `name` set identity bare on the page. */
	header: z.enum(STORY_HEADER_STYLES).default(DEFAULT_BRAND.header),
	headerBackground: hexColor.default(DEFAULT_BRAND.headerBackground),
	/** Sets the name beside the logo, for a logo that is a symbol rather than a wordmark. */
	showName: z.boolean().default(DEFAULT_BRAND.showName),
});

export const storyThemeSchema = z.object({
	surfaces: storySurfacesSchema.default(DEFAULT_SURFACES),
	accent: storyAccentSchema.default(DEFAULT_ACCENT),
	text: storyTextSchema.default(DEFAULT_TEXT),
	block: storyBlockSchema.default(DEFAULT_BLOCK),
	table: storyTableSchema.default(DEFAULT_TABLE),
	charts: storyChartsSchema.default(DEFAULT_CHARTS),
	brand: storyBrandSchema.default(DEFAULT_BRAND),
});

export type StoryTheme = z.infer<typeof storyThemeSchema>;
export type StoryThemeInput = z.input<typeof storyThemeSchema>;

export const STORY_THEME_MODES = ['light', 'dark'] as const;
export type StoryThemeMode = (typeof STORY_THEME_MODES)[number];

export const DEFAULT_STORY_THEME: StoryTheme = storyThemeSchema.parse({});

/** nao's own dark tokens, as hex, so unthemed stories follow the app in dark mode. Only colours change; the schema fills the rest. */
export const DEFAULT_DARK_STORY_THEME: StoryTheme = storyThemeSchema.parse({
	surfaces: { page: '#090a0c', sunken: '#17181c' },
	accent: { color: '#a591ff', ink: '#17181c' },
	text: { headingColor: '#f8fafc', bodyColor: '#c9cbd3', mutedColor: '#8a8d9c' },
	block: { background: '#17181c', borderColor: '#2e2f33' },
	table: { background: '#17181c', headerBackground: '#24262c', headerText: '#f8fafc', borderColor: '#2e2f33' },
	charts: {
		series: ['#0095c7', '#ff6e2c', '#00baa9', '#ffcc04', '#ffac00', '#ff7778', '#b27fff'],
		grid: '#24262c',
	},
	brand: { headerBackground: '#17181c' },
});

export const storyThemePairSchema = z.object({
	light: storyThemeSchema,
	dark: storyThemeSchema,
});

/** One theme per app colour scheme; the story picks the one matching nao's current mode. */
export type StoryThemePair = z.infer<typeof storyThemePairSchema>;

export const DEFAULT_STORY_THEME_PAIR: StoryThemePair = {
	light: DEFAULT_STORY_THEME,
	dark: DEFAULT_DARK_STORY_THEME,
};

export function storyThemeMode(theme: StoryTheme): StoryThemeMode {
	return isDarkSurface(theme.surfaces.page) ? 'dark' : 'light';
}

export function oppositeStoryThemeMode(mode: StoryThemeMode): StoryThemeMode {
	return mode === 'dark' ? 'light' : 'dark';
}

export function parseStoredStoryTheme(raw: unknown): StoryTheme | null {
	return parseStoredJson(raw, storyThemeSchema);
}

export function sameTheme(a: StoryTheme, b: StoryTheme): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function sameThemePair(a: StoryThemePair, b: StoryThemePair): boolean {
	return sameTheme(a.light, b.light) && sameTheme(a.dark, b.dark);
}

/** No name and no logo shows nothing, a missing logo falls back to the name, and the name sits beside a logo only when both exist. */
export function normalizeBrandHeader(brand: StoryTheme['brand']): StoryTheme['brand'] {
	const hasName = brand.name.trim().length > 0;
	const hasLogo = Boolean(brand.logo);
	if (!hasName && !hasLogo) {
		return { ...brand, header: 'none', showName: false };
	}
	if (!hasLogo && (brand.header === 'logo' || brand.header === 'band')) {
		return { ...brand, header: 'name', showName: false };
	}
	if (!hasName && brand.header === 'name') {
		return { ...brand, header: 'logo', showName: false };
	}
	return { ...brand, showName: brand.showName && hasName && hasLogo && brand.header !== 'name' };
}

export function showsBrandIdentity(brand: StoryTheme['brand']): boolean {
	if (brand.header === 'none') {
		return false;
	}
	if (brand.header === 'name') {
		return Boolean(brand.name);
	}
	return Boolean(brand.logo || (brand.showName && brand.name));
}

/**
 * The bridge to the running app: a custom story container gets these as inline
 * CSS custom properties, so nao's components pick the theme up without being
 * rewritten. Names match the tokens already declared in the frontend styles.
 */
export function storyThemeToCssVars(theme: StoryTheme): Record<string, string> {
	const mode = storyThemeMode(theme);
	const vars: Record<string, string> = {
		'--background': theme.surfaces.page,
		'--story-stage': DEFAULT_STORY_THEME_PAIR[mode].surfaces.page,
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
		'--story-accent-text': legibleOn(theme.accent.color, theme.surfaces.page),
		'--ring': theme.accent.color,

		'--border': theme.block.borderColor,
		'--input': theme.block.borderColor,
		'--story-block-border-width': `${theme.block.borderWidth}px`,
		'--story-frame-border-width': `${frameBorderWidth(theme)}px`,
		...radiusScale(theme.block.radius),

		'--story-table-bg': theme.table.background,
		'--story-table-header-bg': theme.table.headerBackground,
		'--story-table-header-fg': theme.table.headerText,
		'--story-table-border': theme.table.borderColor,
		'--story-table-border-width': `${theme.table.borderWidth}px`,

		'--font-sans': theme.text.bodyFont,
		'--font-heading': theme.text.headingFont,
		'--story-heading-scale': String(theme.text.headingScale),
		...typographyCssVars(theme.text.typography),

		'--story-control-radius': `${theme.block.controlRadius}px`,
		...kpiVars(theme),

		'--chart-grid': theme.charts.grid,

		'--story-header-bg': theme.brand.header === 'band' ? theme.brand.headerBackground : 'transparent',
		'--story-header-fg': headerInk(theme),
		'--story-header-padding': theme.brand.header === 'band' ? '28px 32px' : '4px 0 20px',
		'--story-header-rule': ['logo', 'name'].includes(theme.brand.header)
			? `1px solid ${theme.block.borderColor}`
			: '0',
		'--story-header-radius': theme.brand.header === 'band' ? `${theme.block.radius}px` : '0',

		'color-scheme': mode,
	};

	for (let index = 0; index < MAX_CHART_SERIES_COLORS; index++) {
		vars[`--chart-${index + 1}`] = theme.charts.series[index % theme.charts.series.length];
	}
	return vars;
}

/** Blocks whose fill cannot be told from the page. */
export function hasFlatBlocks(theme: StoryTheme): boolean {
	return contrastRatio(theme.block.background, theme.surfaces.page) < FLAT_BLOCK_STEP;
}

/** Filter panels and tabs follow the block border, but keep a hairline when flat blocks would leave them invisible. */
function frameBorderWidth(theme: StoryTheme): number {
	return hasFlatBlocks(theme)
		? Math.max(theme.block.borderWidth, MIN_FLAT_FRAME_BORDER_WIDTH)
		: theme.block.borderWidth;
}

/** Concrete colours rather than `var()` chains: the lead tile re-points `--foreground`, which must not refer to itself. */
function kpiVars(theme: StoryTheme): Record<string, string> {
	const isLead = theme.block.kpiStyle === 'lead';
	const leadBackground = isLead ? theme.text.headingColor : theme.block.background;
	const leadInk = isLead ? theme.surfaces.page : theme.text.headingColor;
	const accentReads = contrastRatio(theme.accent.color, leadBackground) >= LEAD_ACCENT_CONTRAST;
	return {
		'--story-kpi-lead-bg': leadBackground,
		'--story-kpi-lead-fg': leadInk,
		'--story-kpi-lead-muted': isLead ? theme.surfaces.sunken : theme.text.mutedColor,
		'--story-kpi-lead-value': isLead && accentReads ? theme.accent.color : leadInk,
		'--story-kpi-lead-strength': isLead ? '100%' : '0%',
		'--story-kpi-tint': theme.block.kpiStyle === 'tinted' ? '14%' : '0%',
	};
}

function headerInk(theme: StoryTheme): string {
	const background = theme.brand.header === 'band' ? theme.brand.headerBackground : theme.surfaces.page;
	return contrastRatio(theme.text.headingColor, background) >= MIN_HEADER_INK_CONTRAST
		? theme.text.headingColor
		: readableInkFor(background, [theme.text.headingColor, '#ffffff', '#111111']);
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
