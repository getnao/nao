import { formatHex, parse, type Rgb, rgb } from 'culori';

const TRANSPARENT_ALPHA = 0.1;

/** Parses any CSS colour notation into sRGB channels in `[0, 1]`, or null when unreadable. */
export function parseCssColor(raw: string): Rgb | null {
	const parsed = parse(raw.trim().toLowerCase());
	return parsed ? (rgb(parsed) ?? null) : null;
}

/** Normalises any CSS colour to opaque `#rrggbb`; near-transparent values yield null. */
export function cssColorToHex(raw: string, minAlpha = TRANSPARENT_ALPHA): string | null {
	const color = parseCssColor(raw);
	if (!color || (color.alpha ?? 1) < minAlpha) {
		return null;
	}
	return formatHex({ mode: 'rgb', r: color.r, g: color.g, b: color.b });
}
