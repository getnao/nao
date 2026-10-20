import { MIN_CHART_SERIES_COLORS, STORY_HEADER_STYLES, STORY_KPI_STYLES } from '@nao/shared/story-theme';
import { isDarkSurface, relativeLuminance } from '@nao/shared/story-theme-contrast';
import {
	DEFAULT_STORY_TYPOGRAPHY,
	ROLE_LIMITS,
	STORY_ROLE_FONTS,
	STORY_TEXT_CASES,
	STORY_TEXT_ROLES,
	type StoryTextRole,
	type StoryTextRoleStyle,
	type StoryTypography,
} from '@nao/shared/story-theme-typography';
import { z } from 'zod';

import { type BrandCandidate, chromaOf, type DesignSignals, type RoleStyle } from './signals';

export const modelProposalSchema = z.object({
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
	typography: z.string(),
	blockBackground: z.string(),
	blockBorderColor: z.string(),
	blockBorderWidth: z.number(),
	blockRadius: z.number(),
	controlRadius: z.number(),
	kpiStyle: z.enum(STORY_KPI_STYLES),
	paletteSource: z.enum(['brand', 'derive-from-accent']),
	series: z.array(z.string()),
	grid: z.string(),
	barRadius: z.number(),
	brandName: z.string(),
	header: z.enum(STORY_HEADER_STYLES),
	headerBackground: z.string(),
	nameBesideLogo: z.boolean(),
	rationale: z.string(),
});

type ModelProposal = z.infer<typeof modelProposalSchema>;

export type ThemeProposal = Omit<ModelProposal, 'typography'> & { typography: StoryTypography };

export function toThemeProposal(output: ModelProposal): ThemeProposal {
	return { ...output, typography: parseTypography(output.typography) };
}

export function parseTypography(spec: string): StoryTypography {
	const typography = structuredClone(DEFAULT_STORY_TYPOGRAPHY);
	for (const line of spec.split(/[\n;]+/)) {
		const match = line.match(/^\s*[-*]?\s*([a-z]+)\s*:\s*(.+)$/i);
		const role = match?.[1].toLowerCase() as StoryTextRole | undefined;
		if (!match || !role || !STORY_TEXT_ROLES.includes(role)) {
			continue;
		}
		typography[role] = parseTextRole(match[2], typography[role]);
	}
	return typography;
}

/** Tracking and size ranges never overlap, so a lone number is placed by its magnitude rather than its position. */
function parseTextRole(words: string, fallback: StoryTextRoleStyle): StoryTextRoleStyle {
	const role = { ...fallback };
	for (const word of words
		.toLowerCase()
		.split(/[\s,]+/)
		.filter(Boolean)) {
		if ((STORY_ROLE_FONTS as readonly string[]).includes(word)) {
			role.font = word as StoryTextRoleStyle['font'];
		} else if ((STORY_TEXT_CASES as readonly string[]).includes(word)) {
			role.case = word as StoryTextRoleStyle['case'];
		} else if (word === 'italic' || word === 'normal') {
			role.italic = word === 'italic';
		} else if (/^-?\d*\.?\d+(em)?$/.test(word)) {
			const value = parseFloat(word);
			if (Number.isInteger(value) && value >= 100) {
				role.weight = value;
			} else if (word.endsWith('em') || value < ROLE_LIMITS.size.min) {
				role.tracking = value;
			} else {
				role.size = value;
			}
		}
	}
	return role;
}

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
	const controlRadius = roles?.primaryButton?.borderRadius ?? blockRadius;
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
		typography: measuredTypography(roles),
		blockBackground,
		blockBorderColor: roles?.card?.borderColor ?? '',
		blockBorderWidth: roles?.card?.hasBorder ? 1 : 0,
		blockRadius,
		controlRadius,
		kpiStyle: 'plain',
		paletteSource: series.length >= MIN_CHART_SERIES_COLORS ? 'brand' : 'derive-from-accent',
		series,
		grid: '',
		barRadius: barRadiusFromBlock(blockRadius),
		brandName: '',
		header: 'none',
		headerBackground: '',
		nameBesideLogo: false,
		rationale: 'Deterministic mapping from the strongest signals.',
	};
}

/** Measured headings, body copy and buttons speak for their roles; the rest keep nao's voice. */
function measuredTypography(roles: DesignSignals['roles']): StoryTypography {
	const heading = fromMeasuredRole(DEFAULT_STORY_TYPOGRAPHY.heading, roles?.heading);
	return {
		...DEFAULT_STORY_TYPOGRAPHY,
		display: fromMeasuredRole(DEFAULT_STORY_TYPOGRAPHY.display, roles?.heading),
		heading,
		subheading: { ...DEFAULT_STORY_TYPOGRAPHY.subheading, case: heading.case, weight: heading.weight },
		body: fromMeasuredRole(DEFAULT_STORY_TYPOGRAPHY.body, roles?.bodyText),
		button: fromMeasuredRole(DEFAULT_STORY_TYPOGRAPHY.button, roles?.primaryButton),
	};
}

function fromMeasuredRole(fallback: StoryTextRoleStyle, measured: RoleStyle | null | undefined): StoryTextRoleStyle {
	if (!measured) {
		return fallback;
	}
	const transform = measured.textTransform;
	return {
		...fallback,
		weight: Number(measured.fontWeight) || fallback.weight,
		case: transform === 'uppercase' || transform === 'lowercase' || transform === 'capitalize' ? transform : 'none',
		tracking: measured.letterSpacing ?? fallback.tracking,
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
				style.textTransform ? style.textTransform : null,
				style.borderRadius !== null ? `radius ${style.borderRadius}px` : null,
				style.hasBorder ? `border ${style.borderColor ?? 'yes'}` : null,
				style.hasShadow ? 'shadow' : null,
			].filter(Boolean);
			lines.push(`  ${name}: ${bits.join(', ')}${style.sample ? `  ("${style.sample}")` : ''}`);
		}
		lines.push(...describeMeasuredShapes(signals.roles));
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
		'Border radius values across all elements in px (buttons and inputs included, so not the card radius), most used first:',
		signals.radii.map((r) => `  ${r.px}px  x${r.count}`).join('\n') || '  (none declared)',
	);

	return lines.filter((line) => line !== '').join('\n');
}

/** Card and button radii stated outright, so a list of pill buttons is never read as the card shape. */
function describeMeasuredShapes(roles: NonNullable<DesignSignals['roles']>): string[] {
	const shapes = [
		roles.card ? `  cards: ${roles.card.borderRadius ?? 0}px → blockRadius` : null,
		roles.primaryButton ? `  primary button: ${roles.primaryButton.borderRadius ?? 0}px → controlRadius` : null,
	].filter((line): line is string => line !== null);
	return shapes.length > 0 ? ['', 'MEASURED SHAPES, use these values as given:', ...shapes] : [];
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
