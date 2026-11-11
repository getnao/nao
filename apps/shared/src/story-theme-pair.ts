import {
	DEFAULT_DARK_STORY_THEME,
	DEFAULT_STORY_THEME,
	hasFlatBlocks,
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
	blendsInto,
	contrastRatio,
	desaturate,
	hexToOklch,
	legibleOn,
	oklchToHex,
	readableInkFor,
	repairBrandSeries,
	separateSurface,
	shiftLightness,
} from './story-theme-contrast';
import { parseStoredJson } from './utils';

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
const VISIBLE_FILL_CONTRAST = 1.5;
const LINE_STEP = { light: -0.11, dark: 0.14 } as const;

export function parseStoredStoryThemePair(raw: unknown): StoryThemePair | null {
	const pair = parseStoredJson(raw, storyThemePairSchema);
	if (pair) {
		return pair;
	}
	const single = parseStoredStoryTheme(raw);
	return single ? completeStoryThemePair(single) : null;
}

/** Brand identity is the same in both schemes, so a change to it is applied to both variants. */
export function mapPairBrand(
	pair: StoryThemePair,
	transform: (brand: StoryTheme['brand']) => StoryTheme['brand'],
): StoryThemePair {
	return {
		light: { ...pair.light, brand: transform(pair.light.brand) },
		dark: { ...pair.dark, brand: transform(pair.dark.brand) },
	};
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
	const isFlat = hasFlatBlocks(theme);
	const blockBackground = isFlat ? page : flipSurface(theme.block.background, targets.block);
	const blockVanishes =
		!isFlat && theme.block.borderWidth === 0 && contrastRatio(blockBackground, page) < MIN_SURFACE_STEP;
	const line = desaturate(shiftLightness(blockBackground, LINE_STEP[mode]));
	const accent = keepAccentVisible(theme.accent.color, page);

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
			borderWidth: blockVanishes ? 1 : theme.block.borderWidth,
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
			series: repairBrandSeries(theme.charts.series, blockBackground),
			grid: line,
		},
		brand: {
			...theme.brand,
			headerBackground: flipHeaderBackground(
				theme.brand.headerBackground,
				theme.surfaces.page,
				page,
				targets.block,
			),
		},
	});
}

function flipHeaderBackground(background: string, sourcePage: string, page: string, lightness: number): string {
	if (background === sourcePage) {
		return page;
	}
	return hexToOklch(background).c > SURFACE_MAX_CHROMA ? background : flipSurface(background, lightness);
}

/** Keeps the surface's tint while moving it to the other polarity. */
function flipSurface(hex: string, lightness: number): string {
	const { c, h } = hexToOklch(hex);
	return oklchToHex({ l: lightness, c: Math.min(c, SURFACE_MAX_CHROMA), h });
}

function keepAccentVisible(accent: string, page: string): string {
	return blendsInto(accent, page) ? legibleOn(accent, page, VISIBLE_FILL_CONTRAST) : accent;
}
