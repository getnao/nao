import { MIN_CHART_SERIES_COLORS } from '@nao/shared/story-theme';
import { isDarkSurface, relativeLuminance } from '@nao/shared/story-theme-contrast';
import { z } from 'zod';

import { type BrandCandidate, chromaOf, type DesignSignals } from './signals';

export const proposalSchema = z.object({
	page: z.string(),
	sunken: z.string(),
	accent: z.string(),
	headingColor: z.string(),
	bodyColor: z.string(),
	mutedColor: z.string(),
	headingFont: z.string(),
	bodyFont: z.string(),
	headingFontSubstitute: z.string(),
	bodyFontSubstitute: z.string(),
	headingTracking: z.number(),
	blockBackground: z.string(),
	blockBorderColor: z.string(),
	blockBorderWidth: z.number(),
	blockRadius: z.number(),
	paletteSource: z.enum(['brand', 'derive-from-accent']),
	series: z.array(z.string()),
	grid: z.string(),
	barRadius: z.number(),
	rationale: z.string(),
});

export type ThemeProposal = z.infer<typeof proposalSchema>;

export function barRadiusFromBlock(blockRadius: number): number {
	if (blockRadius <= 2) {
		return 0;
	}
	return Math.min(12, Math.max(2, Math.round(blockRadius * 0.6)));
}

export function fallbackProposal(signals: DesignSignals): ThemeProposal {
	const roles = signals.roles;
	const neutrals = signals.colors.filter((c) => chromaOf(c.hex) < 0.06);
	const backgrounds = neutrals.filter((c) => c.properties.some((p) => p.startsWith('background')));
	const inks = neutrals.filter((c) => c.properties.some((p) => p === 'text' || p === 'color'));

	const page =
		roles?.body?.background ??
		signals.surfaces[0] ??
		backgrounds.find((c) => isDarkSurface(c.hex) === signals.prefersDarkGround)?.hex ??
		(signals.prefersDarkGround ? '#121212' : '#ffffff');
	const pageIsDark = isDarkSurface(page);
	const blockBackground = roles?.card?.background ?? page;
	const sunken = signals.surfaces.find((s) => s !== page && isDarkSurface(s) === pageIsDark) ?? '';
	const accent = roles?.primaryButton?.background ?? strongestCandidate(signals.brandCandidates) ?? '';
	const headingColor = roles?.heading?.color ?? darkestInk(inks, pageIsDark) ?? '';
	const bodyColor = roles?.bodyText?.color ?? headingColor;
	const headingFont = roles?.heading?.fontFamily ?? signals.fontFamilies[0]?.stack ?? '';
	const bodyFont = roles?.bodyText?.fontFamily ?? signals.fontFamilies[0]?.stack ?? '';
	const blockRadius = roles?.card?.borderRadius ?? signals.radii[0]?.px ?? 10;
	const series = [
		...signals.brandCandidates.filter((c) => c.chroma >= 0.1 && c.sources.length > 0).map((c) => c.color),
		...signals.writtenColors.filter((hex) => chromaOf(hex) >= 0.08),
	].filter((hex, index, all) => all.indexOf(hex) === index);

	return {
		page,
		sunken,
		accent,
		headingColor,
		bodyColor,
		mutedColor: '',
		headingFont,
		bodyFont,
		headingFontSubstitute: '',
		bodyFontSubstitute: '',
		headingTracking: roles?.heading?.letterSpacing ?? -0.02,
		blockBackground,
		blockBorderColor: roles?.card?.borderColor ?? '',
		blockBorderWidth: roles?.card?.hasBorder ? 1 : 0,
		blockRadius,
		paletteSource: series.length >= MIN_CHART_SERIES_COLORS ? 'brand' : 'derive-from-accent',
		series,
		grid: '',
		barRadius: barRadiusFromBlock(blockRadius),
		rationale: 'Deterministic mapping from the strongest signals.',
	};
}

function strongestCandidate(candidates: BrandCandidate[]): string | null {
	return candidates.find((candidate) => candidate.chroma >= 0.12)?.color ?? candidates[0]?.color ?? null;
}

function darkestInk(inks: { hex: string }[], pageIsDark: boolean): string | null {
	const sorted = [...inks].sort((a, b) => relativeLuminance(a.hex) - relativeLuminance(b.hex));
	return (pageIsDark ? sorted.at(-1) : sorted[0])?.hex ?? null;
}

export function renderSignals(signals: DesignSignals): string {
	const lines: string[] = [
		`Source: ${signals.label}`,
		signals.title ? `Title: ${signals.title}` : '',
		`The ground reads as ${signals.prefersDarkGround ? 'dark' : 'light'}.`,
		`Extraction mode: ${describeMode(signals.mode)}`,
		signals.source === 'combined' || signals.mode === 'combined' ? 'Several sources describe the same brand.' : '',
		'',
	];

	if (signals.writtenColors.length) {
		lines.push(
			'COLOURS WRITTEN AS HEX IN THE SOURCE. These are the palette: copy them into series.',
			...signals.writtenColors.map((hex) => `  ${hex}`),
			'',
		);
	}

	if (signals.brandCandidates.length) {
		lines.push(
			'BRAND COLOUR CANDIDATES, most brand-like first:',
			...signals.brandCandidates.map(
				(c) =>
					`  ${c.color}  saturation ${c.chroma.toFixed(2)}${c.sources.length ? `  [${c.sources.join(', ')}]` : ''}`,
			),
			'',
		);
	}

	if (signals.roles) {
		lines.push('ROLE EVIDENCE, measured from rendered elements:');
		for (const [name, style] of Object.entries(signals.roles)) {
			if (!style) {
				lines.push(`  ${name}: not found`);
				continue;
			}
			const bits = [
				style.background ? `bg ${style.background}` : null,
				style.color ? `text ${style.color}` : null,
				style.fontFamily ? `font ${style.fontFamily}` : null,
				style.fontSize ? `${style.fontSize}px` : null,
				style.fontWeight ? `w${style.fontWeight}` : null,
				style.letterSpacing ? `tracking ${style.letterSpacing}em` : null,
				style.borderRadius !== null ? `radius ${style.borderRadius}px` : null,
				style.hasBorder ? `border ${style.borderColor ?? 'yes'}` : null,
				style.hasShadow ? 'shadow' : null,
			].filter(Boolean);
			lines.push(`  ${name}: ${bits.join(', ')}${style.sample ? `  ("${style.sample}")` : ''}`);
		}
		lines.push(
			'',
			'Largest painted surfaces, most area first:',
			signals.surfaces.map((s) => `  ${s}`).join('\n') || '  (none)',
			'',
		);
	}

	lines.push(
		'Font families found:',
		signals.fontFamilies.map((f) => `  ${f.stack}`).join('\n') || '  (none)',
		'',
		'Design tokens that resolve to a colour:',
		Object.entries(signals.customProperties)
			.slice(0, 40)
			.map(([k, v]) => `  ${k}: ${v}`)
			.join('\n') || '  (none declared)',
		'',
		signals.mode === 'rendered'
			? 'Colours weighted by how much of the page they paint:'
			: 'Most frequent colours, with the properties they appeared in:',
		signals.colors
			.slice(0, 24)
			.map((c) => `  ${c.hex}  [${c.properties.join(', ')}]`)
			.join('\n') || '  (none found)',
		'',
		'Border radius values in px, most used first:',
		signals.radii.map((r) => `  ${r.px}px  x${r.count}`).join('\n') || '  (none declared)',
	);

	return lines.filter((line) => line !== '').join('\n');
}

function describeMode(mode: DesignSignals['mode']): string {
	switch (mode) {
		case 'rendered':
			return 'computed styles from the rendered page';
		case 'static':
			return 'stylesheet text only, a weaker signal';
		case 'zip':
			return 'stylesheets, token files and images from an uploaded ZIP';
		case 'pixels':
			return 'colours sampled from image pixels';
		case 'combined':
			return 'a mix of sources; rendered elements outweigh ZIP tokens, which outweigh sampled pixels';
	}
}
