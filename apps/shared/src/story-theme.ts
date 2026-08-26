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

/**
 * Google Fonts families we are willing to substitute in.
 *
 * Most brands letter themselves in faces they licence and self-host, so we can
 * never load the real thing. Naming it and rendering Arial is the worst of both
 * worlds. Instead we pick the nearest family that is freely loadable, keep the
 * brand face first in the stack so the intent is recorded, and tell the admin
 * what happened. Grouped so an unrecognised face can still be matched by shape.
 */
export const GOOGLE_FONT_SUBSTITUTES = {
	'display-serif': ['Fraunces', 'Playfair Display', 'Instrument Serif', 'Bodoni Moda'],
	'text-serif': ['EB Garamond', 'Lora', 'Source Serif 4', 'Spectral'],
	'geometric-sans': ['Jost', 'Poppins', 'Outfit'],
	'neo-grotesque-sans': ['Inter', 'DM Sans', 'Archivo', 'Manrope', 'Public Sans'],
	'humanist-sans': ['Figtree', 'Nunito Sans', 'Source Sans 3'],
	condensed: ['Archivo Narrow', 'Barlow Condensed', 'Oswald'],
	mono: ['JetBrains Mono', 'IBM Plex Mono', 'Space Mono'],
} as const;

export type FontShape = keyof typeof GOOGLE_FONT_SUBSTITUTES;

export const ALLOWED_GOOGLE_FONTS: readonly string[] = Object.values(GOOGLE_FONT_SUBSTITUTES).flat();

export function isAllowedGoogleFont(family: string): boolean {
	return ALLOWED_GOOGLE_FONTS.some((f) => f.toLowerCase() === family.trim().toLowerCase());
}

/** The stylesheet that actually serves a substituted family. */
export function googleFontLink(families: string[]): string | null {
	const allowed = [...new Set(families.filter(isAllowedGoogleFont))];
	if (!allowed.length) {
		return null;
	}
	const query = allowed.map((f) => `family=${f.trim().replace(/\s+/g, '+')}:wght@400;500;600;700`).join('&');
	return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

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
	/**
	 * Which face carries the numbers. An editorial brand sets its figures in the
	 * display serif, and that single choice does more for recognition than any
	 * colour: a KPI in Fraunces reads as a different product from one in Inter.
	 */
	figureFont: z.enum(['heading', 'body']),
	/** How large KPI figures run, relative to body text. Editorial brands go big. */
	figureScale: z.number().min(1).max(3.2),
	/** Small labels: plain sentence case, or the uppercase tracked eyebrow. */
	labelStyle: z.enum(['plain', 'uppercase-tracked']),
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

export const storyLayoutSchema = z.object({
	/** Padding and gaps. A dense brand stays dense; an editorial one breathes. */
	density: z.enum(['compact', 'regular', 'spacious']),
	/**
	 * Whether the lead chart sits on an inverted ground.
	 *
	 * Alternating a dark block against a light page is a structural move, not a
	 * colour: it is most of why a brand's own site looks like itself and a
	 * dashboard painted in its colours does not.
	 */
	emphasis: z.enum(['none', 'inverted-hero']),
	/** The inverted ground, derived rather than guessed. */
	invertedSurface: hexColor,
	invertedInk: hexColor,
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
	/** Corner radius on bars, in px. Square is a real answer. */
	barRadius: z.number().min(0).max(12),
	/** Gap between bars as a fraction of slot width. Airy or packed. */
	barGap: z.number().min(0.05).max(0.6),
	/** Line stroke weight, in px. */
	lineWidth: z.number().min(1).max(4),
	/** A full grid, or just a baseline and the numbers. */
	axis: z.enum(['full', 'minimal']),
});

export const storyThemeSchema = z.object({
	surfaces: storySurfacesSchema,
	ink: storyInkSchema,
	typography: storyTypographySchema,
	shape: storyShapeSchema,
	layout: storyLayoutSchema,
	charts: storyChartsSchema,
	/** Primary accent: active filters, links, selected states. */
	accent: hexColor,
	accentInk: hexColor,
});

export type StorySurfaces = z.infer<typeof storySurfacesSchema>;
export type StoryInk = z.infer<typeof storyInkSchema>;
export type StoryTypography = z.infer<typeof storyTypographySchema>;
export type StoryShape = z.infer<typeof storyShapeSchema>;
export type StoryLayout = z.infer<typeof storyLayoutSchema>;
export type StoryCharts = z.infer<typeof storyChartsSchema>;
export type StoryTheme = z.infer<typeof storyThemeSchema>;

/**
 * nao's own look, expressed in the contract. Also the fallback whenever a
 * workspace has no published theme, and the base an inferred theme is merged
 * onto so a partial inference can never produce a half-rendered story.
 */
export const DEFAULT_STORY_THEME: StoryTheme = {
	// These are nao's real tokens from apps/frontend/src/styles.css, converted
	// from oklch and composited where the source value is translucent. They must
	// stay in step with that file: the "no template yet" preview is supposed to
	// show what a story actually looks like today, not an idealised palette.
	surfaces: { page: '#ffffff', card: '#ffffff', sunken: '#f8f8f8' },
	ink: { primary: '#262626', secondary: '#4a4a4a', muted: '#808080' },
	typography: {
		headingFont: "Borna, 'Helvetica Neue', Arial, sans-serif",
		bodyFont: "Geist, 'Helvetica Neue', Arial, sans-serif",
		headingTracking: -0.02,
		scale: 1,
		fontLinks: [],
		figureFont: 'body',
		figureScale: 1.6,
		labelStyle: 'plain',
	},
	shape: { radius: 10, border: '#e6e6e6', elevation: 'bordered', controlShape: 'rounded' },
	layout: { density: 'regular', emphasis: 'none', invertedSurface: '#18181c', invertedInk: '#f5f5f7' },
	charts: {
		// --chart-1 .. --chart-7 exactly as shipped. Note that nao's own palette
		// does not pass the contrast guard: chart-2 and chart-7 are the same
		// colour, and several neighbours are too close under simulated colour
		// vision deficiency. That is a real finding about the product's defaults,
		// so it is recorded here rather than papered over with a nicer palette.
		series: ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00', '#ff6467', '#f54900'],
		sequentialAnchor: '#522bff',
		positive: '#22b573',
		negative: '#f5a623',
		grid: '#ebebeb',
		barRadius: 3,
		barGap: 0.25,
		lineWidth: 2,
		axis: 'full',
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
		layout: { ...DEFAULT_STORY_THEME.layout, ...clean(partial.layout) },
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
		'--story-figure-font':
			theme.typography.figureFont === 'heading' ? theme.typography.headingFont : theme.typography.bodyFont,
		'--story-figure-size': `${theme.typography.figureScale}rem`,
		'--story-label-transform': theme.typography.labelStyle === 'uppercase-tracked' ? 'uppercase' : 'none',
		'--story-label-tracking': theme.typography.labelStyle === 'uppercase-tracked' ? '0.09em' : '0',
		'--story-gap': DENSITY[theme.layout.density].gap,
		'--story-pad': DENSITY[theme.layout.density].pad,
		// Kept as their own tokens so a floating layer inside an inverted block can
		// reach the page ink again; --foreground is reassigned in that scope.
		'--story-ink-primary': theme.ink.primary,
		'--story-ink-muted': theme.ink.muted,
		'--story-card': theme.surfaces.card,
		'--story-inverted': theme.layout.invertedSurface,
		'--story-inverted-ink': theme.layout.invertedInk,
		'--story-bar-radius': `${theme.charts.barRadius}px`,
		'--story-bar-gap': String(theme.charts.barGap),
		'--story-line-width': `${theme.charts.lineWidth}px`,
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

/** Padding and gap per density step, in rem. */
const DENSITY = {
	compact: { gap: '0.5rem', pad: '0.625rem' },
	regular: { gap: '0.75rem', pad: '0.875rem' },
	spacious: { gap: '1.25rem', pad: '1.5rem' },
} as const;

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
