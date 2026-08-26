/**
 * The deterministic half of story-theme inference.
 *
 * Kept apart from `story-theme-infer.ts` so it pulls in no database and no
 * model provider: this is the part that must be exhaustively testable, and it
 * is the part that decides whether a proposed palette is allowed near a story.
 */

import {
	DEFAULT_STORY_THEME,
	googleFontLink,
	isAllowedFontLink,
	isAllowedGoogleFont,
	mergeStoryTheme,
	type StoryTheme,
} from '@nao/shared/story-theme';
import {
	contrastRatio,
	deriveSeriesFromAccent,
	desaturate,
	isDarkSurface,
	readableInkFor,
	separateSurface,
	type SeriesIssue,
	shiftLightness,
	snapSeries,
	validateSeries,
} from '@nao/shared/story-theme-contrast';
import { z } from 'zod';

export interface InferenceResult {
	theme: StoryTheme;
	/** Human-readable record of what the guard changed, shown on the review screen. */
	notes: string[];
}

/** What we let the model decide. Deliberately narrower than StoryTheme. */
export const proposalSchema = z.object({
	surfaces: z.object({ page: z.string(), card: z.string(), sunken: z.string() }),
	ink: z.object({ primary: z.string(), secondary: z.string(), muted: z.string() }),
	typography: z.object({
		headingFont: z.string(),
		bodyFont: z.string(),
		headingTracking: z.number(),
		scale: z.number(),
		/** Nearest freely loadable family, chosen from the allowed list. */
		headingFontSubstitute: z.string(),
		bodyFontSubstitute: z.string(),
	}),
	shape: z.object({
		radius: z.number(),
		border: z.string(),
		elevation: z.enum(['flat', 'bordered', 'shadowed']),
		controlShape: z.enum(['pill', 'rounded', 'square']),
	}),
	charts: z.object({
		/**
		 * Whether the brand genuinely has a categorical palette to borrow, or is
		 * monochrome and needs one derived. Classification is a judgement call, so
		 * the model makes it; the generation that follows is deterministic.
		 */
		paletteSource: z.enum(['brand', 'derive-from-accent']),
		series: z.array(z.string()).min(0).max(7),
		sequentialAnchor: z.string(),
		positive: z.string(),
		negative: z.string(),
		grid: z.string(),
	}),
	accent: z.string(),
	rationale: z.string().max(600),
});

/**
 * Everything after the model. Exported so the guard can be tested without a
 * model in the loop, which is where most of the risk lives anyway.
 */
export function applyGuards(
	proposal: z.infer<typeof proposalSchema>,
	signals?: { warnings?: string[] },
	fontLinks: string[] = [],
): InferenceResult {
	const notes: string[] = [...(signals?.warnings ?? [])];

	const sanitized = {
		surfaces: mapValues(proposal.surfaces, hexOrNull),
		ink: mapValues(proposal.ink, hexOrNull),
		typography: {
			headingFont: sanitizeFontStack(proposal.typography.headingFont),
			bodyFont: sanitizeFontStack(proposal.typography.bodyFont),
			headingTracking: clamp(proposal.typography.headingTracking, -0.06, 0.06),
			scale: clamp(proposal.typography.scale, 0.85, 1.25),
			// Links the probe saw on an allowed host, plus the substitute stylesheet
			// built below. Never a URL the model made up.
			fontLinks: [...new Set(fontLinks)].filter(isAllowedFontLink).slice(0, 3),
		},
		shape: {
			radius: clamp(Math.round(proposal.shape.radius), 0, 28),
			border: hexOrNull(proposal.shape.border),
			elevation: proposal.shape.elevation,
			controlShape: proposal.shape.controlShape,
		},
		charts: {
			series: proposal.charts.series.map(hexOrNull).filter((c): c is string => Boolean(c)),
			sequentialAnchor: hexOrNull(proposal.charts.sequentialAnchor),
			positive: hexOrNull(proposal.charts.positive),
			negative: hexOrNull(proposal.charts.negative),
			grid: hexOrNull(proposal.charts.grid),
		},
		accent: hexOrNull(proposal.accent),
	};

	const theme = mergeStoryTheme(sanitized);

	// --- Surface polarity has to be coherent -------------------------------
	//
	// A marketing site happily alternates a bone page with ink sections; a
	// dashboard cannot, because one set of ink tokens is drawn on all three
	// surfaces. Mixing polarities is what produced pale headings on a bone page
	// and pale-on-pale filter chips. Page wins; card and sunken follow it.
	const pageIsDark = isDarkSurface(theme.surfaces.page);
	for (const key of ['card', 'sunken'] as const) {
		if (isDarkSurface(theme.surfaces[key]) !== pageIsDark) {
			const step = key === 'card' ? 0.04 : 0.07;
			theme.surfaces[key] = shiftLightness(theme.surfaces.page, pageIsDark ? step : -step);
			notes.push(
				`surfaces.${key} was the opposite polarity to the page, which leaves text unreadable on one of them. It now sits just off the page colour.`,
			);
		}
	}
	// A card only needs its own ground when nothing else separates it. nao's own
	// default is a white card on a white page with a border doing the work, so
	// forcing a tint here would change the look of every unthemed story.
	if (theme.shape.elevation === 'flat') {
		theme.surfaces.card = separateSurface(theme.surfaces.card, theme.surfaces.page);
	}
	// The sunken surface is always a bare fill, so it has to be visible on its own.
	theme.surfaces.sunken = separateSurface(theme.surfaces.sunken, theme.surfaces.page, 1.1);

	// --- Ink has to survive EVERY surface it is drawn on --------------------
	//
	// The first cut validated ink against the card alone. Headings render on the
	// page and filter chips on the sunken surface, so ink that passed against one
	// could vanish against another.
	const allSurfaces = [theme.surfaces.page, theme.surfaces.card, theme.surfaces.sunken];
	const defaultInk = pageIsDark
		? { primary: '#f5f5f7', secondary: '#b7b9c4', muted: '#8a8d9c' }
		: DEFAULT_STORY_THEME.ink;
	for (const key of ['primary', 'secondary', 'muted'] as const) {
		const min = key === 'muted' ? 3 : 4.5;
		const worst = Math.min(...allSurfaces.map((surface) => contrastRatio(theme.ink[key], surface)));
		if (worst < min) {
			notes.push(
				`ink.${key} fell below ${min}:1 against one of the surfaces (worst ${worst.toFixed(1)}:1), so the nao value is used.`,
			);
			theme.ink[key] = defaultInk[key];
		}
	}

	// An accent that matches the card is not an accent.
	if (theme.accent.toLowerCase() === theme.surfaces.card.toLowerCase()) {
		notes.push('The proposed accent was identical to the card surface, so the nao accent was kept.');
		theme.accent = DEFAULT_STORY_THEME.accent;
	}

	// An accent has to be visible against the surfaces it is placed on.
	if (contrastRatio(theme.accent, theme.surfaces.page) < 1.5) {
		notes.push('The accent was too close to the page colour to register, so the nao accent is used.');
		theme.accent = DEFAULT_STORY_THEME.accent;
	}

	// The accent's foreground is derived, never guessed.
	theme.accentInk = readableInkFor(theme.accent);

	// --- Make the named faces actually loadable ----------------------------
	//
	// A brand face we cannot serve renders as Arial, which is worse than an
	// honest substitute. The model nominates the nearest freely loadable family;
	// we check it against the allowlist and build the stylesheet ourselves.
	const substitutes: string[] = [];
	for (const [slot, nominated] of [
		['headingFont', proposal.typography.headingFontSubstitute],
		['bodyFont', proposal.typography.bodyFontSubstitute],
	] as const) {
		const family = (nominated ?? '').trim();
		if (!isAllowedGoogleFont(family)) {
			continue;
		}
		substitutes.push(family);
		// Brand face first so the intent survives on machines that have it.
		const stack = theme.typography[slot];
		if (!stack.toLowerCase().includes(family.toLowerCase())) {
			const generic = /serif|mono/i.test(stack) && !/sans-serif/i.test(stack) ? 'serif' : 'sans-serif';
			const brandFace = stack.split(',')[0].trim();
			theme.typography[slot] = `${brandFace}, '${family}', ${generic}`;
			notes.push(`${slot}: ${brandFace} cannot be loaded, so ${family} stands in for it.`);
		}
	}
	const substituteLink = googleFontLink(substitutes);
	if (substituteLink) {
		theme.typography.fontLinks = [...theme.typography.fontLinks, substituteLink].slice(0, 4);
	}

	// --- Structure is never a brand colour ---------------------------------
	//
	// Gridlines and hairlines carry no data. A brand hue there decorates the
	// chart and competes with the series, so both are neutral steps off the
	// surface they sit on.
	// Neutral, and within a narrow band off the card: strong enough to read,
	// faint enough to stay behind the data. Desaturating alone was not enough -
	// a dark brand hue became a near-black grid that drew more attention than
	// the series it was supposed to sit behind.
	const SUBTLE = { min: 1.12, max: 1.75 };
	for (const [label, set] of [
		['shape.border', (v: string) => (theme.shape.border = v)],
		['charts.grid', (v: string) => (theme.charts.grid = v)],
	] as const) {
		const current = desaturate(label === 'charts.grid' ? theme.charts.grid : theme.shape.border);
		set(current);
		const ratio = contrastRatio(current, theme.surfaces.card);
		if (ratio < SUBTLE.min || ratio > SUBTLE.max) {
			set(desaturate(shiftLightness(theme.surfaces.card, pageIsDark ? 0.14 : -0.11)));
			notes.push(
				ratio < SUBTLE.min
					? `${label} was invisible against the card surface and was stepped away from it.`
					: `${label} was heavy enough to compete with the data, so it was softened toward the card surface.`,
			);
		}
	}

	// --- The palette --------------------------------------------------------
	//
	// A monochrome brand has no chart colours to borrow. Sampling its
	// photography produces a palette that belongs to the pictures rather than
	// the brand, so we derive one from the accent instead.
	if (proposal.charts.paletteSource === 'derive-from-accent' || sanitized.charts.series.length < 3) {
		theme.charts.series = deriveSeriesFromAccent(theme.accent, 6, theme.surfaces.card);
		// An explicit classification is the more informative reason, so it wins
		// over the "too few colours" fallback when both are true.
		notes.push(
			proposal.charts.paletteSource === 'derive-from-accent'
				? 'This brand has no categorical palette of its own, so the chart colours were derived from its accent rather than sampled from imagery.'
				: 'Fewer than three usable chart colours were proposed, so the palette was derived from the accent.',
		);
	}

	const before = theme.charts.series;
	const report = validateSeries(before, theme.surfaces.card);
	if (!report.ok) {
		const repaired = snapSeries(before, theme.surfaces.card);
		notes.push(...describeRepairs(report.issues, before, repaired));
		theme.charts.series = repaired;
	}

	return { theme, notes };
}

function describeRepairs(issues: SeriesIssue[], before: string[], after: string[]): string[] {
	const notes: string[] = [];
	const byKind = new Map<SeriesIssue['kind'], number>();
	for (const issue of issues) {
		byKind.set(issue.kind, (byKind.get(issue.kind) ?? 0) + 1);
	}
	const label: Record<SeriesIssue['kind'], string> = {
		contrast: 'too close in tone to the card surface',
		lightness: 'outside the readable lightness range for this surface',
		chroma: 'so desaturated it read as grey',
		'cvd-separation': 'indistinguishable under simulated colour-vision deficiency',
		'normal-separation': 'too similar to the neighbouring series',
	};
	for (const [kind, count] of byKind) {
		notes.push(`Adjusted ${count} chart colour${count === 1 ? '' : 's'} that were ${label[kind]}.`);
	}
	const changed = before.map((c, i) => (c === after[i] ? null : `${c} to ${after[i]}`)).filter(Boolean);
	if (changed.length) {
		notes.push(`Palette repairs: ${changed.join(', ')}.`);
	}
	return notes;
}

/** Keep only what is safe to emit into a CSS `font-family` declaration. */
function sanitizeFontStack(raw: string): string {
	const cleaned = raw
		.replace(/[^a-zA-Z0-9\s,'"-]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
	if (!cleaned) {
		return DEFAULT_STORY_THEME.typography.bodyFont;
	}
	return /(serif|sans-serif|monospace|cursive|system-ui)\s*$/i.test(cleaned) ? cleaned : `${cleaned}, sans-serif`;
}

function hexOrNull(value: string): string | undefined {
	const v = value.trim().toLowerCase();
	return /^#[0-9a-f]{6}$/.test(v) ? v : undefined;
}

function mapValues<T extends Record<string, string>>(obj: T, fn: (v: string) => string | undefined) {
	return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)])) as Record<keyof T, string | undefined>;
}

function clamp(v: number, lo: number, hi: number): number {
	if (!Number.isFinite(v)) {
		return lo;
	}
	return Math.min(hi, Math.max(lo, v));
}
