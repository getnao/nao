import {
	DEFAULT_STORY_THEME,
	isAllowedFontStylesheet,
	MAX_CHART_SERIES_COLORS,
	MAX_FONT_STYLESHEETS,
	MIN_CHART_SERIES_COLORS,
	type StoryTheme,
	storyThemeSchema,
} from '@nao/shared/story-theme';
import {
	clampChroma,
	contrastRatio,
	deltaE,
	deriveSeriesFromAccent,
	desaturate,
	distinctHues,
	hexToOklch,
	isDarkSurface,
	readableInkFor,
	separateSurface,
	type SeriesIssue,
	shiftLightness,
	snapSeries,
	validateSeries,
} from '@nao/shared/story-theme-contrast';

import { barRadiusFromBlock, type ThemeProposal } from './proposal';
import { type BrandCandidate, normalizeColor } from './signals';

/**
 * The deterministic half of generation. A model (or the fallback mapping)
 * proposes which colour plays which role; this decides whether the result is
 * legible and repairs it where it is not. It pulls in no database and no model
 * provider so it can be tested exhaustively.
 */

export interface GenerateResult {
	theme: StoryTheme;
	notes: string[];
}

export interface GuardContext {
	brandCandidates?: BrandCandidate[];
	measuredSeries?: string[];
	fontLinks?: string[];
	warnings?: string[];
}

const INK_MAX_CHROMA = 0.025;
const MAX_BLOCK_RADIUS = 18;
const MAX_BLOCK_STEP = 1.22;
const SUBTLE_LINE = { min: 1.12, max: 1.75 };
const DERIVED_SERIES_COUNT = 6;
const DARK_INK = { headingColor: '#f5f5f7', bodyColor: '#c9cbd3', mutedColor: '#8a8d9c' };
const GOOGLE_FONT_FAMILY = /^[A-Za-z][A-Za-z0-9 ]{1,40}$/;

export function applyGuards(proposal: ThemeProposal, context: GuardContext = {}): GenerateResult {
	const notes: string[] = [...(context.warnings ?? [])];
	const base = DEFAULT_STORY_THEME;
	const colors = new ColorReader(proposal);

	const page = colors.read('page', base.surfaces.page);
	const pageIsDark = isDarkSurface(page);
	const blockRadius = clamp(Math.round(proposal.blockRadius), 0, MAX_BLOCK_RADIUS);
	const theme: StoryTheme = storyThemeSchema.parse({
		surfaces: { page, sunken: colors.read('sunken', base.surfaces.sunken) },
		accent: { color: colors.read('accent', base.accent.color), ink: base.accent.ink },
		text: {
			...base.text,
			headingColor: colors.read('headingColor', base.text.headingColor),
			bodyColor: colors.read('bodyColor', base.text.bodyColor),
			mutedColor: colors.read('mutedColor', base.text.mutedColor),
			headingFont: sanitizeFontStack(proposal.headingFont, base.text.headingFont),
			bodyFont: sanitizeFontStack(proposal.bodyFont, base.text.bodyFont),
			headingTracking: clamp(proposal.headingTracking, -0.06, 0.06),
			fontStylesheets: [],
		},
		block: {
			background: colors.read('blockBackground', base.block.background),
			borderColor: colors.read('blockBorderColor', base.block.borderColor),
			borderWidth: clamp(Math.round(proposal.blockBorderWidth), 0, 4),
			radius: blockRadius,
		},
		table: base.table,
		charts: {
			series: base.charts.series,
			grid: colors.read('grid', base.charts.grid),
			barRadius: resolveBarRadius(blockRadius, proposal.barRadius),
		},
	});
	notes.push(...colors.notes());

	guardSurfaces(theme, pageIsDark, notes);
	guardText(theme, pageIsDark, notes);
	guardAccent(theme, context.brandCandidates ?? [], notes);
	guardLines(theme, pageIsDark, notes);
	guardFonts(theme, proposal, context.fontLinks ?? [], notes);
	guardSeries(theme, proposal, context.measuredSeries ?? [], notes);
	deriveTable(theme);

	return { theme: storyThemeSchema.parse(theme), notes };
}

function guardSurfaces(theme: StoryTheme, pageIsDark: boolean, notes: string[]) {
	const { surfaces, block } = theme;
	if (isDarkSurface(surfaces.sunken) !== pageIsDark) {
		surfaces.sunken = shiftLightness(surfaces.page, pageIsDark ? 0.07 : -0.07);
		notes.push(
			'Recessed surfaces were the opposite polarity to the page, so they now sit just off the page colour.',
		);
	}
	surfaces.sunken = separateSurface(surfaces.sunken, surfaces.page, 1.08);

	if (isDarkSurface(block.background) !== pageIsDark) {
		block.background = shiftLightness(surfaces.page, pageIsDark ? 0.04 : -0.04);
		notes.push(
			'Block backgrounds were the opposite polarity to the page, so they now sit just off the page colour.',
		);
	}
	if (contrastRatio(block.background, surfaces.page) > MAX_BLOCK_STEP) {
		block.background = closestStep(surfaces.page, pageIsDark ? 0.03 : -0.03, MAX_BLOCK_STEP);
		notes.push('Block backgrounds were heavy enough to read as slabs, so they were brought closer to the page.');
	}
	if (block.background === surfaces.page && block.borderWidth === 0) {
		block.borderWidth = 1;
		notes.push('Blocks share the page colour and had no border, so a 1px border keeps them visible.');
	}
}

function guardText(theme: StoryTheme, pageIsDark: boolean, notes: string[]) {
	const surfaces = [theme.surfaces.page, theme.surfaces.sunken, theme.block.background];
	const fallback = pageIsDark ? DARK_INK : DEFAULT_STORY_THEME.text;
	const minimums = { headingColor: 4.5, bodyColor: 4.5, mutedColor: 3 } as const;

	for (const key of ['headingColor', 'bodyColor', 'mutedColor'] as const) {
		const neutral = clampChroma(theme.text[key], INK_MAX_CHROMA);
		if (neutral !== theme.text[key]) {
			theme.text[key] = neutral;
			notes.push(`${labelFor(key)} carried too much brand hue for text, so it was pulled back to neutral.`);
		}
		const worst = Math.min(...surfaces.map((surface) => contrastRatio(theme.text[key], surface)));
		if (worst < minimums[key]) {
			theme.text[key] = fallback[key];
			notes.push(
				`${labelFor(key)} fell below ${minimums[key]}:1 against one of the surfaces (${worst.toFixed(1)}:1), so a readable default is used.`,
			);
		}
	}
}

function guardAccent(theme: StoryTheme, candidates: BrandCandidate[], notes: string[]) {
	const strongest = candidates.find((candidate) => candidate.chroma >= 0.12);
	if (strongest) {
		const onThePage = candidates.some((candidate) => deltaE(candidate.color, theme.accent.color) < 12);
		const tooDull = hexToOklch(theme.accent.color).c < strongest.chroma * 0.6;
		if (!onThePage || tooDull) {
			notes.push(
				onThePage
					? `The proposed accent was far duller than the brand's own ${strongest.color}, which was used instead.`
					: `The proposed accent does not appear in the source, so ${strongest.color}, the most brand-like colour found, was used.`,
			);
			theme.accent.color = strongest.color;
		}
	}
	if (theme.accent.color === theme.block.background || contrastRatio(theme.accent.color, theme.surfaces.page) < 1.5) {
		theme.accent.color = DEFAULT_STORY_THEME.accent.color;
		notes.push('The accent was too close to its background to register, so the nao accent is kept.');
	}
	theme.accent.ink = readableInkFor(theme.accent.color);
}

/** Borders and grid lines are structure: neutral, and a soft step off the block. */
function guardLines(theme: StoryTheme, pageIsDark: boolean, notes: string[]) {
	const surface = theme.block.background;
	theme.block.borderColor = guardLine('Block borders', theme.block.borderColor, surface, pageIsDark, notes);
	theme.charts.grid = guardLine('Chart grid lines', theme.charts.grid, surface, pageIsDark, notes);
}

function guardLine(label: string, color: string, surface: string, pageIsDark: boolean, notes: string[]): string {
	const neutral = desaturate(color);
	const ratio = contrastRatio(neutral, surface);
	if (ratio >= SUBTLE_LINE.min && ratio <= SUBTLE_LINE.max) {
		return neutral;
	}
	notes.push(
		ratio < SUBTLE_LINE.min
			? `${label} were invisible against the blocks and were stepped away from them.`
			: `${label} were heavy enough to compete with the data, so they were softened.`,
	);
	return desaturate(shiftLightness(surface, pageIsDark ? 0.14 : -0.11));
}

function guardFonts(theme: StoryTheme, proposal: ThemeProposal, fontLinks: string[], notes: string[]) {
	const stylesheets = [...new Set(fontLinks)].filter(isAllowedFontStylesheet);
	const substitutes: string[] = [];

	const slots = [
		{ key: 'headingFont', nominated: proposal.headingFontSubstitute },
		{ key: 'bodyFont', nominated: proposal.bodyFontSubstitute },
	] as const;
	for (const { key, nominated } of slots) {
		const family = unquoteFamily(nominated);
		if (!GOOGLE_FONT_FAMILY.test(family)) {
			continue;
		}
		const stack = theme.text[key];
		if (!stackNamesFamily(stack, family)) {
			const brandFace = stack.split(',')[0].trim();
			const generic = /serif|mono/i.test(stack) && !/sans-serif/i.test(stack) ? 'serif' : 'sans-serif';
			theme.text[key] = `${brandFace}, '${family}', ${generic}`;
			notes.push(`${brandFace} cannot be loaded by nao, so ${family} stands in for it.`);
		}
		if (!substitutes.includes(family)) {
			substitutes.push(family);
		}
	}

	const substituteLink = googleFontsLink(substitutes);
	theme.text.fontStylesheets = [...(substituteLink ? [substituteLink] : []), ...stylesheets].slice(
		0,
		MAX_FONT_STYLESHEETS,
	);
}

function stackNamesFamily(stack: string, family: string): boolean {
	return stack.split(',').some((face) => unquoteFamily(face).toLowerCase() === family.toLowerCase());
}

function unquoteFamily(raw: string): string {
	return raw
		.trim()
		.replace(/^['"]|['"]$/g, '')
		.trim();
}

/**
 * Measured colours are exact and lead. The model's proposal fills in behind
 * them, and the accent-derived fan only tops up when fewer than three hues
 * are left.
 */
function guardSeries(theme: StoryTheme, proposal: ThemeProposal, measured: string[], notes: string[]) {
	const surface = theme.block.background;
	const proposed =
		proposal.paletteSource === 'brand'
			? proposal.series.map(normalizeColor).filter((hex): hex is string => hex !== null)
			: [];
	const pinned = distinctHues(measured).length;
	const kept = distinctHues([...measured, ...proposed]).slice(0, MAX_CHART_SERIES_COLORS);
	const candidate = kept.length >= MIN_CHART_SERIES_COLORS ? kept : fillFromAccent(kept, theme.accent.color, surface);
	if (candidate.length > kept.length) {
		notes.push(describeFill(kept.length));
	}

	const report = validateSeries(candidate, surface);
	const repaired = report.ok ? candidate : snapSeries(candidate, surface, pinned);
	notes.push(...describeRepairs(report.issues, candidate, repaired));
	theme.charts.series = repaired.length >= MIN_CHART_SERIES_COLORS ? repaired : DEFAULT_STORY_THEME.charts.series;
}

function fillFromAccent(kept: string[], accent: string, surface: string): string[] {
	const derived = deriveSeriesFromAccent(accent, DERIVED_SERIES_COUNT, surface);
	return distinctHues([...kept, ...derived]).slice(0, DERIVED_SERIES_COUNT);
}

function describeFill(keptCount: number): string {
	if (keptCount === 0) {
		return 'This brand has no categorical palette of its own, so the chart colours were derived from its accent.';
	}
	return `Kept ${keptCount} brand colour${keptCount === 1 ? '' : 's'} from the source and derived the rest of the palette from the accent.`;
}

function deriveTable(theme: StoryTheme) {
	theme.table = {
		background: theme.block.background,
		headerBackground: theme.surfaces.sunken,
		headerText: theme.text.headingColor,
		borderColor: theme.block.borderColor,
		borderWidth: 1,
		stripedRows: false,
	};
}

function describeRepairs(issues: SeriesIssue[], before: string[], after: string[]): string[] {
	const labels: Record<SeriesIssue['kind'], string> = {
		contrast: 'too close in tone to the block background',
		lightness: 'outside the readable lightness range',
		chroma: 'so desaturated they read as grey',
		'cvd-separation': 'indistinguishable under simulated colour-vision deficiency',
		'normal-separation': 'too similar to the neighbouring series',
	};
	const byKind = new Map<SeriesIssue['kind'], number>();
	for (const issue of issues) {
		if (before[issue.index] === after[issue.index]) {
			continue;
		}
		byKind.set(issue.kind, (byKind.get(issue.kind) ?? 0) + 1);
	}
	const notes = [...byKind].map(
		([kind, count]) =>
			`Adjusted ${count} chart colour${count === 1 ? '' : 's'} that ${count === 1 ? 'was' : 'were'} ${labels[kind]}.`,
	);
	const changed = before.map((c, i) => (c === after[i] ? null : `${c} to ${after[i]}`)).filter(Boolean);
	if (changed.length) {
		notes.push(`Palette repairs: ${changed.join(', ')}.`);
	}
	return notes;
}

function closestStep(from: string, step: number, maxRatio: number): string {
	let softened = from;
	for (let i = 1; i <= 8; i++) {
		const next = shiftLightness(from, step * i);
		if (contrastRatio(next, from) > maxRatio) {
			break;
		}
		softened = next;
	}
	return softened;
}

function googleFontsLink(families: string[]): string | null {
	if (families.length === 0) {
		return null;
	}
	const query = families.map(
		(family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700`,
	);
	return `https://fonts.googleapis.com/css2?${query.join('&')}&display=swap`;
}

function sanitizeFontStack(raw: string, fallback: string): string {
	const cleaned = raw
		.replace(/[^a-zA-Z0-9\s,'"-]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 180);
	if (!cleaned) {
		return fallback;
	}
	return /(serif|sans-serif|monospace|cursive|system-ui)\s*$/i.test(cleaned) ? cleaned : `${cleaned}, sans-serif`;
}

function labelFor(key: 'headingColor' | 'bodyColor' | 'mutedColor'): string {
	return { headingColor: 'Heading colour', bodyColor: 'Body colour', mutedColor: 'Muted colour' }[key];
}

type ProposalColorKey =
	| 'page'
	| 'sunken'
	| 'accent'
	| 'headingColor'
	| 'bodyColor'
	| 'mutedColor'
	| 'blockBackground'
	| 'blockBorderColor'
	| 'grid';

/**
 * Reads proposal colours in any CSS notation. An empty slot means "no
 * opinion" and takes the default quietly; a slot that holds something
 * unreadable takes the default too, but says so.
 */
class ColorReader {
	private readonly unreadable: string[] = [];

	constructor(private readonly proposal: ThemeProposal) {}

	read(key: ProposalColorKey, fallback: string): string {
		const raw = this.proposal[key].trim();
		if (!raw) {
			return fallback;
		}
		const hex = normalizeColor(raw);
		if (!hex) {
			this.unreadable.push(`${key} (${raw.slice(0, 24)})`);
			return fallback;
		}
		return hex;
	}

	notes(): string[] {
		if (this.unreadable.length === 0) {
			return [];
		}
		return [
			`Some proposed colours could not be read, so nao defaults are used for them: ${this.unreadable.join(', ')}.`,
		];
	}
}

function resolveBarRadius(blockRadius: number, proposed: number): number {
	const derived = barRadiusFromBlock(blockRadius);
	const clamped = clamp(Math.round(proposed), 0, 12);
	if (blockRadius <= 2) {
		return 0;
	}
	return Math.max(derived, clamped);
}

function clamp(v: number, lo: number, hi: number): number {
	return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
