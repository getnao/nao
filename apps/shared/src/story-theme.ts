import { z } from 'zod';

/**
 * The story theme contract.
 *
 * A brand design system is infinite; a story is not. Stories are built from a
 * bounded component vocabulary (headings, prose, KPI tiles, filter bar, tables,
 * bar/line/pie charts), so theming them does not require replicating a design
 * system - it requires filling a fixed set of slots that those components read.
 *
 * Everything downstream (the inference step, the admin review screen, the CSS
 * variables injected on the story container) speaks this shape and nothing else.
 * Adding a slot here is the only way to widen what a brand can influence.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const hexColor = z.string().regex(HEX, 'Expected a 6-digit hex colour such as #522bff.');

/** Font stacks are emitted straight into CSS, so keep them to a safe subset. */
const fontStack = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.regex(/^[a-zA-Z0-9\s,'"-]+$/, 'Font stack may only contain letters, numbers, spaces, quotes, commas and hyphens.');

export const storySurfacesSchema = z.object({
	/** Page ground behind the story. */
	page: hexColor,
	/** Block/card ground: KPI tiles, table cards, chart cards. */
	card: hexColor,
	/** Recessed ground: table header, filter bar, inactive segments. */
	sunken: hexColor,
});

export const storyInkSchema = z.object({
	/** Headings and figures. */
	primary: hexColor,
	/** Body copy. */
	secondary: hexColor,
	/** Axis ticks, captions, helper text. */
	muted: hexColor,
});

/**
 * Stylesheet URLs that actually load the brand's faces.
 *
 * A font-family string on its own is decoration: if nothing serves the file the
 * browser silently falls back and the story renders in Arial. Only hosts that
 * publicly serve webfonts are allowed, and never the brand's own origin - their
 * licensed faces are theirs to serve, not ours to hotlink.
 */
export const FONT_CDN_HOSTS = [
	'fonts.googleapis.com',
	'fonts.gstatic.com',
	'fonts.bunny.net',
	'use.typekit.net',
	'p.typekit.net',
] as const;

export function isAllowedFontLink(raw: string): boolean {
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && FONT_CDN_HOSTS.some((h) => url.hostname === h);
	} catch {
		return false;
	}
}

export const storyTypographySchema = z.object({
	headingFont: fontStack,
	bodyFont: fontStack,
	/** Stylesheets to load so the named faces actually resolve. */
	fontLinks: z.array(z.string().refine(isAllowedFontLink, 'Font stylesheet host is not allowed.')).max(4).default([]),
	/** Applied to headings only; brand display faces are often tightly tracked. */
	headingTracking: z.number().min(-0.06).max(0.06),
	/** Multiplier on the component type scale. Lets a dense brand stay dense. */
	scale: z.number().min(0.85).max(1.25),
});

export const storyShapeSchema = z.object({
	/** Corner radius in px. 0 is a legitimate, opinionated answer. */
	radius: z.number().min(0).max(28),
	/** Hairline colour for rules, table borders, card outlines. */
	border: hexColor,
	/** Whether cards are separated by borders, shadows, or surface alone. */
	elevation: z.enum(['flat', 'bordered', 'shadowed']),
	/** Filter controls: brands are usually clearly one or the other. */
	controlShape: z.enum(['pill', 'rounded', 'square']),
});

export const storyChartsSchema = z.object({
	/**
	 * Categorical series, assigned in order and never cycled. Validated for
	 * contrast and colour-vision separation against `surfaces.card` before it is
	 * ever stored - see story-theme-contrast.ts.
	 */
	series: z.array(hexColor).min(3).max(7),
	/** Single-hue ramp anchor for sequential encodings (heatmaps, choropleths). */
	sequentialAnchor: hexColor,
	/** Positive/negative semantics. Kept out of `series` so they stay meaningful. */
	positive: hexColor,
	negative: hexColor,
	/** Grid and axis lines. */
	grid: hexColor,
});

export const storyThemeSchema = z.object({
	surfaces: storySurfacesSchema,
	ink: storyInkSchema,
	typography: storyTypographySchema,
	shape: storyShapeSchema,
	charts: storyChartsSchema,
	/** Primary accent: active filters, links, selected states. */
	accent: hexColor,
	accentInk: hexColor,
});

export type StorySurfaces = z.infer<typeof storySurfacesSchema>;
export type StoryInk = z.infer<typeof storyInkSchema>;
export type StoryTypography = z.infer<typeof storyTypographySchema>;
export type StoryShape = z.infer<typeof storyShapeSchema>;
export type StoryCharts = z.infer<typeof storyChartsSchema>;
export type StoryTheme = z.infer<typeof storyThemeSchema>;

/**
 * nao's own look, expressed in the contract. Also the fallback whenever a
 * workspace has no published theme, and the base an inferred theme is merged
 * onto so a partial inference can never produce a half-rendered story.
 */
export const DEFAULT_STORY_THEME: StoryTheme = {
	surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#f5f5f7' },
	ink: { primary: '#18181c', secondary: '#4a4d57', muted: '#82859a' },
	typography: {
		headingFont: "Borna, 'Helvetica Neue', Arial, sans-serif",
		bodyFont: "Geist, 'Helvetica Neue', Arial, sans-serif",
		headingTracking: -0.02,
		scale: 1,
		fontLinks: [],
	},
	shape: { radius: 10, border: '#e4e4f0', elevation: 'bordered', controlShape: 'rounded' },
	charts: {
		// nao purple anchors slot 1; the rest are the output of snapSeries on a
		// hue-spread seed, so the shipped default provably passes its own guard.
		series: ['#522bff', '#288abb', '#c44310', '#42a35e', '#a31db0', '#b6540c', '#038965'],
		sequentialAnchor: '#522bff',
		positive: '#22b573',
		negative: '#f5a623',
		grid: '#eeeef7',
	},
	accent: '#522bff',
	accentInk: '#ffffff',
};

/**
 * Merge a partial theme onto the default. The inference step is allowed to
 * return only the slots it is confident about; everything else falls back to
 * nao's own values rather than to something guessed.
 */
export function mergeStoryTheme(partial: DeepPartial<StoryTheme> | null | undefined): StoryTheme {
	if (!partial) {
		return DEFAULT_STORY_THEME;
	}
	return {
		surfaces: { ...DEFAULT_STORY_THEME.surfaces, ...clean(partial.surfaces) },
		ink: { ...DEFAULT_STORY_THEME.ink, ...clean(partial.ink) },
		typography: {
			...DEFAULT_STORY_THEME.typography,
			...clean(partial.typography),
			fontLinks: (partial.typography?.fontLinks ?? []).filter(
				(l): l is string => typeof l === 'string' && isAllowedFontLink(l),
			),
		},
		shape: { ...DEFAULT_STORY_THEME.shape, ...clean(partial.shape) },
		charts: {
			...DEFAULT_STORY_THEME.charts,
			...clean(partial.charts),
			series: partial.charts?.series?.length
				? (partial.charts.series.filter((c): c is string => typeof c === 'string') as string[])
				: DEFAULT_STORY_THEME.charts.series,
		},
		accent: partial.accent ?? DEFAULT_STORY_THEME.accent,
		accentInk: partial.accentInk ?? DEFAULT_STORY_THEME.accentInk,
	};
}

/**
 * The bridge to the running app: the story container gets these as inline CSS
 * custom properties, so every existing component picks the theme up without
 * being rewritten. Names match the tokens already in styles.css.
 */
export function storyThemeToCssVars(theme: StoryTheme): Record<string, string> {
	const vars: Record<string, string> = {
		'--background': theme.surfaces.page,
		'--panel': theme.surfaces.sunken,
		'--card': theme.surfaces.card,
		'--popover': theme.surfaces.card,
		'--secondary': theme.surfaces.sunken,
		'--muted': theme.surfaces.sunken,
		'--accent': theme.surfaces.sunken,

		'--foreground': theme.ink.primary,
		'--card-foreground': theme.ink.primary,
		'--popover-foreground': theme.ink.primary,
		'--secondary-foreground': theme.ink.secondary,
		'--accent-foreground': theme.ink.primary,
		'--muted-foreground': theme.ink.muted,

		'--primary': theme.accent,
		'--primary-foreground': theme.accentInk,
		'--ring': theme.accent,

		'--border': theme.shape.border,
		'--input': theme.shape.border,
		'--radius': `${theme.shape.radius}px`,

		'--font-sans': theme.typography.bodyFont,
		'--font-heading': theme.typography.headingFont,
		'--story-heading-tracking': `${theme.typography.headingTracking}em`,
		'--story-type-scale': String(theme.typography.scale),
		'--story-control-radius': controlRadius(theme.shape),
		'--story-elevation': theme.shape.elevation,

		'--chart-grid': theme.charts.grid,
		'--chart-positive': theme.charts.positive,
		'--chart-negative': theme.charts.negative,
		'--chart-sequential': theme.charts.sequentialAnchor,
	};

	// --chart-1..7 are consumed directly by the existing chart components.
	for (let i = 0; i < 7; i++) {
		vars[`--chart-${i + 1}`] = theme.charts.series[i % theme.charts.series.length];
	}
	return vars;
}

function controlRadius(shape: StoryShape): string {
	if (shape.controlShape === 'pill') {
		return '9999px';
	}
	if (shape.controlShape === 'square') {
		return '0px';
	}
	return `${shape.radius}px`;
}

function clean<T extends object>(value: DeepPartial<T> | undefined): Partial<T> {
	if (!value) {
		return {};
	}
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};
