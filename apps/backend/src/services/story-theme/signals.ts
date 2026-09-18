import { cssColorToHex } from '@nao/shared/color';
import { hexToOklch, isDarkSurface } from '@nao/shared/story-theme-contrast';

/**
 * Design signals read from a source (a rendered page, stylesheet text, a ZIP
 * of brand assets). Generation decides which candidate plays which role; the
 * signals only report what was found and how load-bearing it looked.
 */

/** A source the admin gave us cannot be read; the message is shown as-is. */
export class DesignSourceError extends Error {}

export type SignalSource = 'url' | 'zip' | 'image' | 'combined';
export type ExtractionMode = 'rendered' | 'static' | 'zip' | 'pixels' | 'combined';

export interface ColorCandidate {
	hex: string;
	/** Declarations or painted area, depending on the mode; a proxy for weight. */
	count: number;
	properties: string[];
}

export interface BrandCandidate {
	color: string;
	chroma: number;
	sources: string[];
}

export interface RoleStyle {
	background: string | null;
	color: string | null;
	fontFamily: string | null;
	fontSize: number | null;
	fontWeight: string | null;
	letterSpacing: number | null;
	borderRadius: number | null;
	borderColor: string | null;
	hasBorder: boolean;
	hasShadow: boolean;
	sample: string | null;
}

export interface RoleEvidence {
	body: RoleStyle | null;
	heading: RoleStyle | null;
	bodyText: RoleStyle | null;
	primaryButton: RoleStyle | null;
	secondaryButton: RoleStyle | null;
	card: RoleStyle | null;
	input: RoleStyle | null;
}

export interface DesignSignals {
	source: SignalSource;
	mode: ExtractionMode;
	label: string;
	title: string | null;
	customProperties: Record<string, string>;
	colors: ColorCandidate[];
	brandCandidates: BrandCandidate[];
	surfaces: string[];
	roles: RoleEvidence | null;
	fontFamilies: { stack: string; count: number }[];
	fontLinks: string[];
	radii: { px: number; count: number }[];
	prefersDarkGround: boolean;
	writtenColors: string[];
	warnings: string[];
}

const COLOR_PROPERTIES = ['background-color', 'background', 'color', 'border-color', 'border', 'fill', 'stroke'];
const COLOR_TOKEN = /#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

export function emptySignals(source: SignalSource, mode: ExtractionMode, label: string): DesignSignals {
	return {
		source,
		mode,
		label,
		title: null,
		customProperties: {},
		colors: [],
		brandCandidates: [],
		surfaces: [],
		roles: null,
		fontFamilies: [],
		fontLinks: [],
		radii: [],
		prefersDarkGround: false,
		writtenColors: [],
		warnings: [],
	};
}

export function mergeSignals(parts: DesignSignals[]): DesignSignals {
	if (parts.length === 0) {
		throw new Error('mergeSignals requires at least one source.');
	}
	if (parts.length === 1) {
		return parts[0];
	}

	const colors = parts.reduce<ColorCandidate[]>((all, part) => mergeColors(all, part.colors), []);
	const customProperties: Record<string, string> = {};
	for (const part of [...parts].reverse()) {
		Object.assign(customProperties, part.customProperties);
	}
	const sources = new Set(parts.map((part) => part.source));
	const modes = new Set(parts.map((part) => part.mode));

	return {
		source: sources.size === 1 ? parts[0].source : 'combined',
		mode: modes.size === 1 ? parts[0].mode : 'combined',
		label: parts.map((part) => part.label).join(' + '),
		title: parts.find((part) => part.title)?.title ?? null,
		customProperties,
		colors,
		brandCandidates: rankBrandCandidates(colors, customProperties),
		surfaces: uniqueStrings(parts.flatMap((part) => part.surfaces)),
		roles: parts.find((part) => part.roles)?.roles ?? null,
		fontFamilies: mergeCounted(
			parts.flatMap((part) => part.fontFamilies),
			(item) => item.stack,
		),
		fontLinks: uniqueStrings(parts.flatMap((part) => part.fontLinks)),
		radii: mergeCounted(
			parts.flatMap((part) => part.radii),
			(item) => String(item.px),
		),
		prefersDarkGround:
			parts.find((part) => part.roles || part.mode === 'rendered')?.prefersDarkGround ??
			parts[0].prefersDarkGround,
		writtenColors: uniqueStrings(parts.flatMap((part) => part.writtenColors)),
		warnings: parts.flatMap((part) => part.warnings),
	};
}

/** Reads what stylesheet text declares: tokens, colours, font stacks, radii. */
export function signalsFromCss(css: string, base: DesignSignals): DesignSignals {
	const customProperties = collectCustomProperties(css);
	const colors = collectColors(css, customProperties);
	return {
		...base,
		customProperties: { ...base.customProperties, ...customProperties },
		colors: mergeColors(base.colors, colors),
		brandCandidates: rankBrandCandidates(colors, customProperties),
		fontFamilies: collectFontFamilies(css),
		radii: collectRadii(css),
		prefersDarkGround: looksDarkGround(css, colors),
	};
}

export function collectCustomProperties(css: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)[;}]/gi)) {
		const hex = normalizeColor(value.trim());
		if (hex) {
			out[name.toLowerCase()] = hex;
		}
	}
	return out;
}

export function collectColors(css: string, customProperties: Record<string, string>): ColorCandidate[] {
	const tally = new Map<string, { count: number; properties: Set<string> }>();
	const bump = (hex: string, property: string) => {
		const entry = tally.get(hex) ?? { count: 0, properties: new Set<string>() };
		entry.count++;
		entry.properties.add(property);
		tally.set(hex, entry);
	};

	for (const [, property, value] of css.matchAll(
		/([a-z-]+)\s*:\s*([^;{}]*(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))[^;{}]*)[;}]/gi,
	)) {
		const prop = property.toLowerCase();
		if (!COLOR_PROPERTIES.includes(prop) && !prop.startsWith('--')) {
			continue;
		}
		for (const token of value.match(COLOR_TOKEN) ?? []) {
			const hex = normalizeColor(token);
			if (hex) {
				bump(hex, prop);
			}
		}
	}

	for (const hex of Object.values(customProperties)) {
		bump(hex, 'design-token');
	}

	return [...tally.entries()]
		.map(([hex, v]) => ({ hex, count: v.count, properties: [...v.properties] }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 40);
}

export function collectFontFamilies(css: string): { stack: string; count: number }[] {
	const tally = new Map<string, number>();
	for (const [, value] of css.matchAll(/font-family\s*:\s*([^;{}]+)[;}]/gi)) {
		const stack = value.replace(/\s+/g, ' ').trim();
		if (!stack || stack.length > 200 || stack.startsWith('var(')) {
			continue;
		}
		tally.set(stack, (tally.get(stack) ?? 0) + 1);
	}
	return [...tally.entries()]
		.map(([stack, count]) => ({ stack, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 12);
}

export function collectRadii(css: string): { px: number; count: number }[] {
	const tally = new Map<number, number>();
	for (const [, value] of css.matchAll(/border-radius\s*:\s*([^;{}]+)[;}]/gi)) {
		const px = lengthToPx(value.trim().split(/\s+/)[0]);
		if (px === null || px > 64) {
			continue;
		}
		const rounded = Math.round(px);
		tally.set(rounded, (tally.get(rounded) ?? 0) + 1);
	}
	return [...tally.entries()]
		.map(([px, count]) => ({ px, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 6);
}

/** Saturation first, then whether it was declared as a token; greys never qualify. */
export function rankBrandCandidates(
	colors: ColorCandidate[],
	customProperties: Record<string, string>,
): BrandCandidate[] {
	const tokenColors = new Set(Object.values(customProperties));
	return colors
		.map((candidate) => {
			const chroma = chromaOf(candidate.hex);
			const sources = tokenColors.has(candidate.hex) ? ['design-token'] : [];
			const score =
				chroma * 100 + (sources.length ? 45 : 0) + Math.min(Math.log10(Math.max(candidate.count, 1)) * 4, 20);
			return { color: candidate.hex, chroma, sources, score };
		})
		.filter((candidate) => candidate.chroma >= 0.06)
		.sort((a, b) => b.score - a.score)
		.slice(0, 6)
		.map(({ color, chroma, sources }) => ({ color, chroma, sources }));
}

/** Normalises any CSS colour notation to `#rrggbb`; near-transparent values yield null. */
export function normalizeColor(raw: string): string | null {
	return cssColorToHex(raw);
}

export function chromaOf(hex: string): number {
	return hexToOklch(hex).c;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function mergeCounted<T extends { count: number }>(items: T[], keyOf: (item: T) => string): T[] {
	const merged = new Map<string, T>();
	for (const item of items) {
		const key = keyOf(item);
		const existing = merged.get(key);
		merged.set(key, existing ? { ...item, count: existing.count + item.count } : item);
	}
	return [...merged.values()].sort((a, b) => b.count - a.count);
}

function mergeColors(a: ColorCandidate[], b: ColorCandidate[]): ColorCandidate[] {
	const merged = new Map<string, ColorCandidate>();
	for (const candidate of [...a, ...b]) {
		const existing = merged.get(candidate.hex);
		merged.set(
			candidate.hex,
			existing
				? {
						hex: candidate.hex,
						count: existing.count + candidate.count,
						properties: [...new Set([...existing.properties, ...candidate.properties])],
					}
				: candidate,
		);
	}
	return [...merged.values()].sort((x, y) => y.count - x.count).slice(0, 40);
}

function looksDarkGround(css: string, colors: ColorCandidate[]): boolean {
	const bodyBlock = /(?:^|[\s,}])(?:html|body)\s*\{([^}]*)\}/i.exec(css)?.[1] ?? '';
	const declared = /background(?:-color)?\s*:\s*([^;]+)/i.exec(bodyBlock)?.[1];
	const hex = declared ? normalizeColor(declared.trim().split(/\s+/)[0]) : null;
	const target = hex ?? colors.find((c) => c.properties.includes('background-color'))?.hex;
	return target ? isDarkSurface(target) : false;
}

function lengthToPx(value: string): number | null {
	const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
	if (px) {
		return Number(px[1]);
	}
	const rem = /^(\d+(?:\.\d+)?)r?em$/.exec(value);
	return rem ? Number(rem[1]) * 16 : null;
}
