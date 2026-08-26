/**
 * Deterministic colour guard for inferred story themes.
 *
 * Brand palettes are designed for marketing surfaces, not for encoding data. A
 * hero green that sings on a landing page can be unreadable as a bar fill, and
 * two brand tints that feel distinct in a style guide can be indistinguishable
 * once they are 4px wide and side by side.
 *
 * So nothing an LLM proposes reaches a story unchecked. Every candidate series
 * runs through `validateSeries`, and anything that fails is repaired by
 * `snapSeries`, which moves lightness and chroma while holding hue - the brand
 * keeps its colours, the chart keeps its legibility.
 *
 * No dependencies: this runs on the backend during inference and in the browser
 * for the live admin preview.
 */

export interface Oklch {
	l: number;
	c: number;
	h: number;
}

export type CvdKind = 'protan' | 'deutan' | 'tritan';

export interface SeriesIssue {
	index: number;
	color: string;
	/** `pair` issues name the other index involved. */
	otherIndex?: number;
	kind: 'contrast' | 'lightness' | 'chroma' | 'cvd-separation' | 'normal-separation';
	detail: string;
}

export interface SeriesReport {
	ok: boolean;
	issues: SeriesIssue[];
}

/** Minimum WCAG contrast between a mark and the surface it sits on. */
const MIN_CONTRAST = 3;
/** Below this, a hue reads as grey and stops carrying identity. */
const MIN_CHROMA = 0.1;
/** OKLab dE x100 between adjacent series under simulated colour-vision deficiency. */
const MIN_CVD_DELTA = 8;
/** OKLab dE x100 between adjacent series for full colour vision. Hard floor. */
const MIN_NORMAL_DELTA = 15;
/** Usable lightness window per surface polarity: too light glares, too dark muddies. */
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] } as const;
/** Where a palette starts when the brand's own accent carries no hue. */
const ACHROMATIC_ANCHOR_HUE = 250;

/* ------------------------------------------------------------------ colour */

export function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function rgbToHex(rgb: [number, number, number]): string {
	const part = (v: number) =>
		Math.round(Math.min(1, Math.max(0, v)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function linearRgb(hex: string): [number, number, number] {
	const [r, g, b] = hexToRgb(hex);
	return [toLinear(r), toLinear(g), toLinear(b)];
}

/** Bjorn Ottosson's OKLab, from linear sRGB. */
function linearToOklab(lin: [number, number, number]): [number, number, number] {
	const [r, g, b] = lin;
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function oklabToLinear(lab: [number, number, number]): [number, number, number] {
	const [L, A, B] = lab;
	const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
	const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
	const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

export function hexToOklch(hex: string): Oklch {
	const [L, a, b] = linearToOklab(linearRgb(hex));
	return { l: L, c: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI };
}

export function oklchToHex({ l, c, h }: Oklch): string {
	const rad = (h * Math.PI) / 180;
	const lin = oklabToLinear([l, Math.cos(rad) * c, Math.sin(rad) * c]);
	return rgbToHex([toSrgb(lin[0]), toSrgb(lin[1]), toSrgb(lin[2])]);
}

/** True when a colour survives the sRGB gamut round trip without clipping. */
function inGamut({ l, c, h }: Oklch): boolean {
	const rad = (h * Math.PI) / 180;
	const lin = oklabToLinear([l, Math.cos(rad) * c, Math.sin(rad) * c]);
	return lin.every((v) => v >= -0.001 && v <= 1.001);
}

/* --------------------------------------------------------------------- cvd */

/** Brettel/Vienot dichromat matrices, applied in linear sRGB. */
const CVD_MATRIX: Record<CvdKind, number[][]> = {
	protan: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998],
	],
	deutan: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881],
	],
	tritan: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039],
	],
};

export function simulateCvd(hex: string, kind: CvdKind): string {
	const lin = linearRgb(hex);
	const m = CVD_MATRIX[kind];
	const out = m.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]) as [number, number, number];
	return rgbToHex([toSrgb(out[0]), toSrgb(out[1]), toSrgb(out[2])]);
}

/** OKLab Euclidean distance, x100 so thresholds read as whole numbers. */
export function deltaE(a: string, b: string): number {
	const [l1, a1, b1] = linearToOklab(linearRgb(a));
	const [l2, a2, b2] = linearToOklab(linearRgb(b));
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

/* ---------------------------------------------------------------- contrast */

function relativeLuminance(hex: string): number {
	const [r, g, b] = linearRgb(hex);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

export function isDarkSurface(hex: string): boolean {
	return relativeLuminance(hex) < 0.2;
}

/* -------------------------------------------------------------- validation */

/**
 * Check a categorical series against the surface it will be drawn on.
 *
 * Only adjacent pairs are compared: series 1 and 2 sit next to each other in a
 * stack or a legend and must be told apart, series 1 and 6 rarely do.
 */
export function validateSeries(series: string[], surface: string): SeriesReport {
	const issues: SeriesIssue[] = [];
	const [lo, hi] = isDarkSurface(surface) ? BAND.dark : BAND.light;

	series.forEach((color, index) => {
		const { l, c } = hexToOklch(color);
		if (l < lo || l > hi) {
			issues.push({
				index,
				color,
				kind: 'lightness',
				detail: `L ${l.toFixed(3)} outside the ${lo}-${hi} band for this surface.`,
			});
		}
		if (c < MIN_CHROMA) {
			issues.push({ index, color, kind: 'chroma', detail: `Chroma ${c.toFixed(3)} reads as grey.` });
		}
		const ratio = contrastRatio(color, surface);
		if (ratio < MIN_CONTRAST) {
			issues.push({
				index,
				color,
				kind: 'contrast',
				detail: `Contrast ${ratio.toFixed(2)}:1 against the surface.`,
			});
		}
	});

	for (let i = 1; i < series.length; i++) {
		const a = series[i - 1];
		const b = series[i];
		const normal = deltaE(a, b);
		if (normal < MIN_NORMAL_DELTA) {
			issues.push({
				index: i,
				otherIndex: i - 1,
				color: b,
				kind: 'normal-separation',
				detail: `dE ${normal.toFixed(1)} against the previous series, below the ${MIN_NORMAL_DELTA} floor.`,
			});
		}
		for (const kind of ['protan', 'deutan', 'tritan'] as CvdKind[]) {
			const d = deltaE(simulateCvd(a, kind), simulateCvd(b, kind));
			if (d < MIN_CVD_DELTA) {
				issues.push({
					index: i,
					otherIndex: i - 1,
					color: b,
					kind: 'cvd-separation',
					detail: `dE ${d.toFixed(1)} under simulated ${kind}opia, below the ${MIN_CVD_DELTA} floor.`,
				});
			}
		}
	}

	return { ok: issues.length === 0, issues };
}

/**
 * Repair a series so it passes `validateSeries`, holding each colour's hue.
 *
 * Hue carries the brand, so hue is what we protect. Lightness and chroma are
 * treated as free variables: for each series slot we try the lightnesses
 * closest to the original first and take the first one that clears the surface
 * and separates from its neighbour. Only when no lightness in the band works
 * does the hue rotate, and a rotated hue is the last resort because it is the
 * one change a brand owner will actually notice.
 */
export function snapSeries(series: string[], surface: string): string[] {
	const [lo, hi] = isDarkSurface(surface) ? BAND.dark : BAND.light;
	const hues = assignHues(series);
	const out: string[] = [];

	for (let i = 0; i < series.length; i++) {
		out.push(place(series[i], hues[i], lo, hi, surface, out[i - 1]));
	}
	return out;
}

/**
 * Keep each colour's own hue when it has one. A near-grey has no meaningful
 * hue (atan2 of two zeros), so those slots are spread evenly around the wheel
 * instead, away from whatever hues the palette already uses.
 */
function assignHues(series: string[]): number[] {
	const parsed = series.map(hexToOklch);
	const hueless = parsed.map((p) => p.c < 0.02);
	const known = parsed.filter((_, i) => !hueless[i]).map((p) => p.h);
	let spread = 0;
	return parsed.map((p, i) => {
		if (!hueless[i]) {
			return p.h;
		}
		// Walk the wheel until we find a gap the existing hues do not occupy.
		let candidate = (spread * 97) % 360;
		let guard = 0;
		while (guard < 36 && known.some((h) => hueDistance(h, candidate) < 40)) {
			candidate = (candidate + 40) % 360;
			guard++;
		}
		spread++;
		known.push(candidate);
		return candidate;
	});
}

function hueDistance(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return Math.min(d, 360 - d);
}

/**
 * Candidate lightnesses across the band, nearest the original first.
 *
 * Inset from the band edges: hex is 8-bit, so a colour generated exactly at
 * `lo` round-trips back a hair under it and would fail its own validation.
 */
function lightnessCandidates(original: number, lo: number, hi: number): number[] {
	const steps: number[] = [];
	for (let l = lo + EDGE_INSET; l <= hi - EDGE_INSET + 1e-9; l += 0.02) {
		steps.push(Number(l.toFixed(4)));
	}
	const start = clamp(original, lo + EDGE_INSET, hi - EDGE_INSET);
	return steps.sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
}

/** Quantisation headroom kept away from every threshold when generating. */
const EDGE_INSET = 0.01;
const CHROMA_TARGET = MIN_CHROMA + 0.015;

/**
 * Re-read a generated hex and confirm it still clears the per-colour checks.
 * Generating in OKLCH and validating in OKLCH would let 8-bit rounding slip a
 * colour past by a thousandth; validating the emitted hex cannot.
 */
function passesSolo(hex: string, surface: string, lo: number, hi: number): boolean {
	const { l, c } = hexToOklch(hex);
	return l >= lo && l <= hi && c >= MIN_CHROMA && contrastRatio(hex, surface) >= MIN_CONTRAST;
}

function place(source: string, hue: number, lo: number, hi: number, surface: string, previous?: string): string {
	// A colour that already works is left exactly as the brand supplied it.
	if (passesSolo(source, surface, lo, hi) && (!previous || pairSeparated(previous, source))) {
		return source;
	}

	const original = hexToOklch(source);
	const rotations = [0, 20, -20, 40, -40, 60, -60, 90, -90, 120, -120, 180];

	for (const rotation of rotations) {
		const h = (((hue + rotation) % 360) + 360) % 360;
		for (const l of lightnessCandidates(original.l, lo, hi)) {
			const ceiling = maxChroma(l, h);
			if (ceiling < CHROMA_TARGET) {
				continue;
			}
			const c = clamp(original.c, CHROMA_TARGET, ceiling);
			const hex = oklchToHex({ l, c, h });
			if (!passesSolo(hex, surface, lo, hi)) {
				continue;
			}
			if (previous && !pairSeparated(previous, hex)) {
				continue;
			}
			return hex;
		}
	}

	// Nothing in the band worked for this hue family. Fall back to a reference
	// colour known to sit inside the band, so a story never renders unstyled.
	return fallbackFor(previous, lo, hi, surface);
}

function fallbackFor(previous: string | undefined, lo: number, hi: number, surface: string): string {
	const mid = (lo + hi) / 2;
	for (let h = 0; h < 360; h += 15) {
		for (const l of [mid, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75]) {
			const ceiling = maxChroma(l, h);
			if (ceiling < CHROMA_TARGET) {
				continue;
			}
			const hex = oklchToHex({ l, c: Math.min(0.14, ceiling), h });
			if (!passesSolo(hex, surface, lo, hi)) {
				continue;
			}
			if (!previous || pairSeparated(previous, hex)) {
				return hex;
			}
		}
	}
	return oklchToHex({ l: mid, c: MIN_CHROMA, h: 280 });
}

function pairSeparated(a: string, b: string): boolean {
	if (deltaE(a, b) < MIN_NORMAL_DELTA) {
		return false;
	}
	return (['protan', 'deutan', 'tritan'] as CvdKind[]).every(
		(kind) => deltaE(simulateCvd(a, kind), simulateCvd(b, kind)) >= MIN_CVD_DELTA,
	);
}

/** Largest chroma that still round-trips through sRGB at this lightness and hue. */
function maxChroma(l: number, h: number): number {
	let low = 0;
	let high = 0.4;
	for (let i = 0; i < 18; i++) {
		const mid = (low + high) / 2;
		if (inGamut({ l, c: mid, h })) {
			low = mid;
		} else {
			high = mid;
		}
	}
	return low;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

/**
 * Build a categorical palette from a brand that does not have one.
 *
 * Plenty of brands are monochrome by design: black on cream, one accent, and
 * photography doing the rest. Asked for six distinct chart hues, a model has
 * nothing to draw on and starts sampling the photographs, which is where a
 * heritage fashion brand ends up with terracotta and leaf-green bars.
 *
 * So when there is no palette to read, we generate one instead of guessing:
 * hues evenly spaced around the wheel from the brand's own accent, held at a
 * restrained chroma so it reads editorial rather than primary-coloured, then
 * put through the same guard as any other palette.
 */
export function deriveSeriesFromAccent(accent: string, count: number, surface: string): string[] {
	const parsed = hexToOklch(accent);
	// A near-black or near-white accent has no meaningful hue: atan2 on two
	// values near zero returns noise, so #121212 and #131313 could anchor the
	// whole palette on different hues. Fall back to a stable anchor instead.
	const anchor = parsed.c < 0.02 ? ACHROMATIC_ANCHOR_HUE : parsed.h;
	const [lo, hi] = isDarkSurface(surface) ? BAND.dark : BAND.light;
	const mid = (lo + hi) / 2;
	const swing = (hi - lo) * 0.18;

	const seeds: string[] = [];
	const used: number[] = [];
	for (let i = 0; i < count; i++) {
		// Two offsets can be pushed onto the same edge of the muddy arc and land
		// on the same hue. snapSeries only compares neighbours, so a duplicate in
		// non-adjacent slots would survive it.
		const hue = nextFreeHue(harmonicHue(anchor, i), used);
		used.push(hue);
		const l = i % 2 === 0 ? mid + swing : mid - swing;
		seeds.push(oklchToHex({ l, c: Math.min(HARMONIC_CHROMA, maxChroma(l, hue)), h: hue }));
	}
	return snapSeries(seeds, surface);
}

/**
 * Where each slot sits relative to the brand's own hue.
 *
 * Spacing hues evenly around the wheel is what produced the maroon-and-olive
 * pairing that looked so bad: 360/n walks straight through the dull part of the
 * spectrum and puts unrelated hues side by side. Designers do not do that. They
 * work an arc around a base hue and reach for the complement for contrast, so
 * the set reads as one family.
 *
 * These offsets are an analogous fan with a complementary pair folded in, which
 * keeps six colours related without any two of them fighting.
 */
const HARMONIC_OFFSETS = [0, 180, -35, 145, 70, -110, 35, -145];
/** Held constant across the set: varying saturation is what makes a palette look accidental. */
const HARMONIC_CHROMA = 0.125;
/**
 * Hues in this arc go muddy at mid lightness - mustard, olive, khaki. A
 * designer sidesteps them; so do we, by nudging to whichever edge is nearer.
 */
const MUDDY_ARC = [58, 138] as const;
/** Minimum wheel separation between any two slots, muddy-arc clamping included. */
const MIN_HUE_GAP = 22;

function hueGap(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return Math.min(d, 360 - d);
}

/**
 * Walk to the next hue that is both usable and far enough from every hue
 * already taken. Stepping by a fixed amount is not enough on its own: a step
 * that lands inside the muddy arc gets clamped straight back to the edge it
 * came from, which is how two slots ended up on the same colour.
 */
function nextFreeHue(start: number, used: number[]): number {
	let hue = harmonicHue(start, 0);
	for (let step = 0; step < 24; step++) {
		if (!used.some((u) => hueGap(u, hue) < MIN_HUE_GAP)) {
			return hue;
		}
		const next = (hue + MIN_HUE_GAP) % 360;
		// Jump the arc rather than bouncing off its edge.
		hue = next > MUDDY_ARC[0] && next < MUDDY_ARC[1] ? MUDDY_ARC[1] + 6 : next;
	}
	return hue;
}

function harmonicHue(anchor: number, index: number): number {
	const raw = anchor + HARMONIC_OFFSETS[index % HARMONIC_OFFSETS.length];
	const hue = ((raw % 360) + 360) % 360;
	if (hue <= MUDDY_ARC[0] || hue >= MUDDY_ARC[1]) {
		return hue;
	}
	const toLow = hue - MUDDY_ARC[0];
	const toHigh = MUDDY_ARC[1] - hue;
	return toLow < toHigh ? MUDDY_ARC[0] - 6 : MUDDY_ARC[1] + 6;
}

/**
 * Strip a colour of its hue.
 *
 * Gridlines and hairlines are structure, not data. Painting them in a brand hue
 * makes a chart look decorated and competes with the series, so they are always
 * neutral steps off their own surface.
 */
export function desaturate(hex: string): string {
	const { l } = hexToOklch(hex);
	return oklchToHex({ l, c: 0, h: 0 });
}

/** Move a colour along lightness, holding hue, staying inside sRGB. */
export function shiftLightness(hex: string, delta: number): string {
	const oklch = hexToOklch(hex);
	const l = clamp(oklch.l + delta, 0, 1);
	let c = oklch.c;
	while (c > 0 && !inGamut({ ...oklch, l, c })) {
		c -= 0.005;
	}
	return oklchToHex({ l, c: Math.max(c, 0), h: oklch.h });
}

/**
 * Nudge a surface away from a reference one so the two are visibly distinct.
 * Used to keep card and sunken from collapsing into the page.
 */
export function separateSurface(surface: string, from: string, minRatio = 1.06): string {
	if (contrastRatio(surface, from) >= minRatio) {
		return surface;
	}
	const away = isDarkSurface(from) ? 1 : -1;
	let out = surface;
	for (let i = 0; i < 12; i++) {
		out = shiftLightness(out, away * 0.02);
		if (contrastRatio(out, from) >= minRatio) {
			break;
		}
	}
	return out;
}

/**
 * Pick readable ink for a filled surface. Used for the accent's foreground so a
 * pale brand accent does not end up with white text on it.
 */
export function readableInkFor(surface: string, candidates: string[] = ['#ffffff', '#111111']): string {
	return candidates.reduce((best, c) => (contrastRatio(c, surface) > contrastRatio(best, surface) ? c : best));
}
