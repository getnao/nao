import {
	clampChroma as culoriClampChroma,
	differenceEuclidean,
	filterDeficiencyDeuter,
	filterDeficiencyProt,
	filterDeficiencyTrit,
	formatHex,
	lrgb,
	oklch,
	type Rgb,
	wcagContrast,
	wcagLuminance,
} from 'culori';

export interface Oklch {
	l: number;
	c: number;
	h: number;
}

export type CvdKind = 'protan' | 'deutan' | 'tritan';

export interface SeriesIssue {
	index: number;
	color: string;
	otherIndex?: number;
	kind: 'contrast' | 'lightness' | 'chroma' | 'cvd-separation' | 'normal-separation';
	detail: string;
}

export interface SeriesReport {
	ok: boolean;
	issues: SeriesIssue[];
}

const MIN_CONTRAST = 3;
const MIN_CHROMA = 0.1;
const MIN_CVD_DELTA = 8;
const MIN_NORMAL_DELTA = 15;
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] } as const;
const ACHROMATIC_ANCHOR_HUE = 250;
const EDGE_INSET = 0.01;
const CHROMA_TARGET = MIN_CHROMA + 0.015;
const HARMONIC_OFFSETS = [0, 180, -35, 145, 70, -110, 35, -145];
const HARMONIC_CHROMA = 0.125;
/** Hues that go muddy at mid lightness (mustard, olive, khaki). */
const MUDDY_ARC = [58, 138] as const;
const MIN_HUE_GAP = 22;
const SAME_HUE_GAP = 12;

export function rgbToHex([r, g, b]: [number, number, number]): string {
	return formatHex({ mode: 'rgb', r, g, b });
}

export function hexToOklch(hex: string): Oklch {
	const parsed = oklch(hex) ?? { l: 0, c: 0, h: 0 };
	return { l: parsed.l, c: parsed.c, h: parsed.h ?? 0 };
}

export function oklchToHex({ l, c, h }: Oklch): string {
	return formatHex({ mode: 'oklch', l, c, h });
}

/**
 * Machado's matrices are defined on linear RGB, but culori multiplies whatever
 * `rgb` channels it is handed, so linear values are passed in and read back.
 */
export function simulateCvd(hex: string, kind: CvdKind): string {
	const linear = lrgb(hex) ?? { r: 0, g: 0, b: 0 };
	const filtered = CVD_FILTER[kind]({ mode: 'rgb', r: linear.r, g: linear.g, b: linear.b });
	return formatHex({ mode: 'lrgb', r: filtered.r, g: filtered.g, b: filtered.b });
}

/** OKLab Euclidean distance, x100 so thresholds read as whole numbers. */
export function deltaE(a: string, b: string): number {
	return oklabDistance(a, b) * 100;
}

export function contrastRatio(a: string, b: string): number {
	return wcagContrast(a, b);
}

export function relativeLuminance(hex: string): number {
	return wcagLuminance(hex);
}

export function isDarkSurface(hex: string): boolean {
	return relativeLuminance(hex) < 0.2;
}

/** Checks each colour against the surface and each adjacent pair against each other. */
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
 * Repairs a series for contrast, lightness and chroma while holding hue.
 * Adjacent-pair separation (including CVD) is attempted with a small hue
 * nudge; if that would invent a new colour, the brand hue is kept. The first
 * `pinned` colours were measured from the brand itself and stay verbatim
 * whenever they are legible on their own.
 */
export function snapSeries(series: string[], surface: string, pinned = 0): string[] {
	const [lo, hi] = isDarkSurface(surface) ? BAND.dark : BAND.light;
	const hues = assignHues(series);
	const out: string[] = [];

	for (let i = 0; i < series.length; i++) {
		const holdVerbatim = i < pinned && passesSolo(series[i], surface, lo, hi);
		out.push(holdVerbatim ? series[i] : place(series[i], hues[i], lo, hi, surface, out[i - 1]));
	}
	return out;
}

/**
 * Builds a categorical palette for a brand that has none: an analogous fan
 * around the accent hue with a complementary pair folded in, at a restrained
 * constant chroma, then guarded like any other palette.
 */
export function deriveSeriesFromAccent(accent: string, count: number, surface: string): string[] {
	const parsed = hexToOklch(accent);
	const anchor = parsed.c < 0.02 ? ACHROMATIC_ANCHOR_HUE : parsed.h;
	const [lo, hi] = isDarkSurface(surface) ? BAND.dark : BAND.light;
	const mid = (lo + hi) / 2;
	const swing = (hi - lo) * 0.18;

	const seeds: string[] = [];
	const used: number[] = [];
	for (let i = 0; i < count; i++) {
		const hue = nextFreeHue(harmonicHue(anchor, i), used);
		used.push(hue);
		const l = i % 2 === 0 ? mid + swing : mid - swing;
		seeds.push(oklchToHex({ l, c: Math.min(HARMONIC_CHROMA, maxChroma(l, hue)), h: hue }));
	}
	return snapSeries(seeds, surface);
}

/** Keeps the first colour of each hue so several tints of one brand blue count as one series colour. */
export function distinctHues(series: string[]): string[] {
	const kept: string[] = [];
	const hues: number[] = [];
	for (const color of series) {
		const { c, h } = hexToOklch(color);
		if (c >= 0.02 && hues.some((hue) => hueGap(hue, h) < SAME_HUE_GAP)) {
			continue;
		}
		kept.push(color);
		if (c >= 0.02) {
			hues.push(h);
		}
	}
	return kept;
}

export function clampChroma(hex: string, max: number): string {
	const oklch = hexToOklch(hex);
	return oklch.c <= max ? hex : oklchToHex({ ...oklch, c: max });
}

export function desaturate(hex: string): string {
	const { l } = hexToOklch(hex);
	return oklchToHex({ l, c: 0, h: 0 });
}

/** Moves a colour along lightness, holding hue, staying inside sRGB. */
export function shiftLightness(hex: string, delta: number): string {
	const { l, c, h } = hexToOklch(hex);
	return formatHex(culoriClampChroma({ mode: 'oklch', l: clamp(l + delta, 0, 1), c, h }, 'oklch'));
}

/** Nudges a surface away from a reference one until the two are visibly distinct. */
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

export function readableInkFor(surface: string, candidates: string[] = ['#ffffff', '#111111']): string {
	return candidates.reduce((best, c) => (contrastRatio(c, surface) > contrastRatio(best, surface) ? c : best));
}

const oklabDistance = differenceEuclidean('oklab');

const CVD_FILTER: Record<CvdKind, (color: Rgb) => Rgb> = {
	protan: filterDeficiencyProt(1),
	deutan: filterDeficiencyDeuter(1),
	tritan: filterDeficiencyTrit(1),
};

/** Keeps each colour's own hue; near-greys get hues spread away from the ones in use. */
function assignHues(series: string[]): number[] {
	const parsed = series.map(hexToOklch);
	const hueless = parsed.map((p) => p.c < 0.02);
	const known = parsed.filter((_, i) => !hueless[i]).map((p) => p.h);
	let spread = 0;
	return parsed.map((p, i) => {
		if (!hueless[i]) {
			return p.h;
		}
		let candidate = (spread * 97) % 360;
		let guard = 0;
		while (guard < 36 && known.some((h) => hueGap(h, candidate) < 40)) {
			candidate = (candidate + 40) % 360;
			guard++;
		}
		spread++;
		known.push(candidate);
		return candidate;
	});
}

export function hueGap(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return Math.min(d, 360 - d);
}

function lightnessCandidates(original: number, lo: number, hi: number): number[] {
	const steps: number[] = [];
	for (let l = lo + EDGE_INSET; l <= hi - EDGE_INSET + 1e-9; l += 0.02) {
		steps.push(Number(l.toFixed(4)));
	}
	const start = clamp(original, lo + EDGE_INSET, hi - EDGE_INSET);
	return steps.sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
}

/** Re-reads the emitted hex so 8-bit rounding cannot slip a colour past a threshold. */
function passesSolo(hex: string, surface: string, lo: number, hi: number): boolean {
	const { l, c } = hexToOklch(hex);
	return l >= lo && l <= hi && c >= MIN_CHROMA && contrastRatio(hex, surface) >= MIN_CONTRAST;
}

function place(source: string, hue: number, lo: number, hi: number, surface: string, previous?: string): string {
	if (passesSolo(source, surface, lo, hi) && (!previous || pairSeparated(previous, source))) {
		return source;
	}

	const original = hexToOklch(source);
	const search = (h: number, requirePair: boolean): string | null => {
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
			if (requirePair && previous && !pairSeparated(previous, hex)) {
				continue;
			}
			return hex;
		}
		return null;
	};

	const heldWithPair = search(hue, true);
	if (heldWithPair) {
		return heldWithPair;
	}

	for (const rotation of [12, -12, 22, -22, 32, -32]) {
		const h = (((hue + rotation) % 360) + 360) % 360;
		const hex = search(h, true);
		if (hex) {
			return hex;
		}
	}

	return search(hue, false) ?? fallbackFor(previous, lo, hi, surface);
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
	return culoriClampChroma({ mode: 'oklch', l, c: 0.4, h }, 'oklch').c;
}

function nextFreeHue(start: number, used: number[]): number {
	let hue = harmonicHue(start, 0);
	for (let step = 0; step < 24; step++) {
		if (!used.some((u) => hueGap(u, hue) < MIN_HUE_GAP)) {
			return hue;
		}
		const next = (hue + MIN_HUE_GAP) % 360;
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

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}
