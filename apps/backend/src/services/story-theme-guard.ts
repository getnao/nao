/**
 * The deterministic half of story-theme inference.
 *
 * Kept apart from `story-theme-infer.ts` so it pulls in no database and no
 * model provider: this is the part that must be exhaustively testable, and it
 * is the part that decides whether a proposed palette is allowed near a story.
 */

import { DEFAULT_STORY_THEME, mergeStoryTheme, type StoryTheme } from '@nao/shared/story-theme';
import {
	isDarkSurface,
	readableInkFor,
	type SeriesIssue,
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
	}),
	shape: z.object({
		radius: z.number(),
		border: z.string(),
		elevation: z.enum(['flat', 'bordered', 'shadowed']),
		controlShape: z.enum(['pill', 'rounded', 'square']),
	}),
	charts: z.object({
		series: z.array(z.string()).min(3).max(7),
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

	// Checked before the merge: mergeStoryTheme would have already substituted
	// the nao series, so afterwards there is nothing left to notice.
	if (sanitized.charts.series.length < 3) {
		notes.push('Fewer than three usable chart colours were proposed, so the nao series was kept.');
	}

	const theme = mergeStoryTheme(sanitized);

	// Ink has to survive its own surface, whatever the model thought.
	const cardIsDark = isDarkSurface(theme.surfaces.card);
	const defaultInk = cardIsDark
		? { primary: '#f5f5f7', secondary: '#b7b9c4', muted: '#8a8d9c' }
		: DEFAULT_STORY_THEME.ink;
	for (const key of ['primary', 'secondary', 'muted'] as const) {
		if (contrastTooLow(theme.ink[key], theme.surfaces.card, key === 'muted' ? 3 : 4.5)) {
			notes.push(`ink.${key} was unreadable on the card surface and fell back to the nao value.`);
			theme.ink[key] = defaultInk[key];
		}
	}

	// The accent's foreground is derived, never guessed.
	theme.accentInk = readableInkFor(theme.accent);

	// The part the model does not get to decide.
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

function contrastTooLow(fg: string, bg: string, min: number): boolean {
	const lum = (hex: string) => {
		const channel = (i: number) => {
			const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
			return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
	};
	const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
	return (hi + 0.05) / (lo + 0.05) < min;
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
