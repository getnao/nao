import {
	DEFAULT_DARK_STORY_THEME,
	DEFAULT_STORY_THEME,
	oppositeStoryThemeMode,
	parseStoredStoryTheme,
	type StoryTheme,
	type StoryThemeMode,
	storyThemeMode,
	type StoryThemePair,
	storyThemePairSchema,
	storyThemeSchema,
} from './story-theme';
import {
	contrastRatio,
	desaturate,
	hexToOklch,
	oklchToHex,
	readableInkFor,
	separateSurface,
	shiftLightness,
	snapSeries,
} from './story-theme-contrast';

/**
 * A theme is authored for one colour scheme; its counterpart keeps the brand
 * (accent, hues, fonts, shapes) and swaps the grounds and inks to the other
 * polarity. Legacy rows hold a single theme and are completed on read.
 */

const SURFACE_LIGHTNESS = {
	light: { page: 0.995, sunken: 0.965, block: 1 },
	dark: { page: 0.16, sunken: 0.25, block: 0.21 },
} as const;
const SURFACE_MAX_CHROMA = 0.02;
const MIN_SURFACE_STEP = 1.08;
const FLAT_BLOCK_STEP = 1.03;
const MIN_ACCENT_CONTRAST = 3;
const ACCENT_LIGHTNESS_STEP = 0.05;
const LINE_STEP = { light: -0.11, dark: 0.14 } as const;

export function parseStoredStoryThemePair(raw: unknown): StoryThemePair | null {
	const value = typeof raw === 'string' ? safeJsonParse(raw) : raw;
	if (value === null || typeof value !== 'object') {
		return null;
	}
	const pair = storyThemePairSchema.safeParse(value);
	if (pair.success) {
		return pair.data;
	}
	const single = parseStoredStoryTheme(value);
	return single ? completeStoryThemePair(single) : null;
}

export function completeStoryThemePair(theme: StoryTheme): StoryThemePair {
	const mode = storyThemeMode(theme);
	const other = oppositeStoryThemeMode(mode);
	return { [mode]: theme, [other]: deriveStoryThemeVariant(theme, other) } as StoryThemePair;
}

export function deriveStoryThemeVariant(theme: StoryTheme, mode: StoryThemeMode): StoryTheme {
	if (storyThemeMode(theme) === mode) {
		return theme;
	}
	const base = mode === 'dark' ? DEFAULT_DARK_STORY_THEME : DEFAULT_STORY_THEME;
	const targets = SURFACE_LIGHTNESS[mode];

	const page = flipSurface(theme.surfaces.page, targets.page);
	const sunken = separateSurface(flipSurface(theme.surfaces.sunken, targets.sunken), page, MIN_SURFACE_STEP);
	const isFlat = contrastRatio(theme.block.background, theme.surfaces.page) < FLAT_BLOCK_STEP;
	const blockBackground = isFlat ? page : flipSurface(theme.block.background, targets.block);
	const blockNeedsBorder = contrastRatio(blockBackground, page) < MIN_SURFACE_STEP && theme.block.borderWidth === 0;
	const line = desaturate(shiftLightness(blockBackground, LINE_STEP[mode]));
	const accent = liftAccent(theme.accent.color, page, mode);

	return storyThemeSchema.parse({
		surfaces: { page, sunken },
		accent: { color: accent, ink: readableInkFor(accent) },
		text: {
			...theme.text,
			headingColor: base.text.headingColor,
			bodyColor: base.text.bodyColor,
			mutedColor: base.text.mutedColor,
		},
		block: {
			...theme.block,
			background: blockBackground,
			borderColor: line,
			borderWidth: blockNeedsBorder ? 1 : theme.block.borderWidth,
		},
		table: {
			...theme.table,
			background: blockBackground,
			headerBackground: sunken,
			headerText: base.text.headingColor,
			borderColor: line,
		},
		charts: {
			...theme.charts,
			series: snapSeries(theme.charts.series, blockBackground),
			grid: line,
		},
	});
}

/** Keeps the surface's tint while moving it to the other polarity. */
function flipSurface(hex: string, lightness: number): string {
	const { c, h } = hexToOklch(hex);
	return oklchToHex({ l: lightness, c: Math.min(c, SURFACE_MAX_CHROMA), h });
}

/** A brand accent chosen for one ground can sink into the other; it is nudged until it registers. */
function liftAccent(accent: string, page: string, mode: StoryThemeMode): string {
	const direction = mode === 'dark' ? 1 : -1;
	let lifted = accent;
	for (let step = 0; step < 8 && contrastRatio(lifted, page) < MIN_ACCENT_CONTRAST; step++) {
		lifted = shiftLightness(lifted, direction * ACCENT_LIGHTNESS_STEP);
	}
	return lifted;
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
