import { deltaE, isDarkSurface, relativeLuminance, rgbToHex } from '@nao/shared/story-theme-contrast';
import { type Color, getPalette } from 'colorthief';
import { classifySwatches } from 'colorthief/internals';

import { type ColorCandidate, type DesignSignals, emptySignals, rankBrandCandidates } from './signals';

/**
 * Reads brand colours from an image. ColorThief (OKLCH MMCQ) does the
 * quantization and Vibrant-role scoring; sharp decodes the pixels. The only
 * custom pass is shell detection: corners vs the centre, for a document sitting
 * in editor chrome.
 */

const SAMPLE_SIZE = 800;
const PALETTE_COLORS = 16;
const CORNER_AGREE_RGB = 28;
const SHELL_CORNER_LUM = 0.15;
const SHELL_CENTER_LIFT = 0.2;
const SNAP_MAX_DELTA = 26;
const SNAP_MIN_SHARE = 0.0005;
const SNAP_MAX_CANDIDATES = 3000;
const OPAQUE_ALPHA = 200;

interface Bitmap {
	data: Uint8Array;
	width: number;
	height: number;
}

export interface DocumentGround {
	center: string;
	shellDetected: boolean;
}

export interface ImageSample {
	signals: DesignSignals;
	ground: DocumentGround | null;
}

/** Cheaper than `sampleImage` when only the shell/editor-chrome check is needed: skips palette quantization. */
export async function detectGround(image: { data: Uint8Array }): Promise<DocumentGround | null> {
	const bitmap = await decodeImage(image.data);
	return detectDocumentGround(bitmap);
}

export async function sampleImage(image: { data: Uint8Array; mediaType: string }, label: string): Promise<ImageSample> {
	const bitmap = await decodeImage(image.data);
	const ground = detectDocumentGround(bitmap);
	const palette = await getPalette(Buffer.from(image.data), {
		loader: {
			load: async () => ({
				data: bitmap.data,
				width: bitmap.width,
				height: bitmap.height,
				colorSpace: 'srgb',
			}),
		},
		colorCount: PALETTE_COLORS,
		quality: 1,
		ignoreWhite: false,
		colorSpace: 'oklch',
	});
	if (!palette || palette.length === 0) {
		throw new Error('No opaque pixels could be read from the image.');
	}

	const colors = palette.map(asColorCandidate);
	const accents = accentCandidates(palette);
	const dominant = palette[0].hex();
	const signals: DesignSignals = {
		...emptySignals('image', 'pixels', label),
		colors,
		brandCandidates: rankBrandCandidates(accents.length > 0 ? accents : colors, {}),
		surfaces: palette.slice(0, 3).map((color) => color.hex()),
		prefersDarkGround: isDarkSurface(dominant),
		warnings: [],
	};
	if (ground?.shellDetected) {
		signals.prefersDarkGround = isDarkSurface(ground.center);
		signals.surfaces = [ground.center, ...signals.surfaces.filter((surface) => surface !== ground.center)];
	}
	return { signals, ground };
}

/** A repeated colour snaps like its first occurrence; distinct colours never collapse onto the same painted one. */
export async function snapToImageColors(image: { data: Uint8Array }, colors: string[]): Promise<string[]> {
	const painted = await paintedColors(image);
	const snappedByColor = new Map<string, string>();
	const taken = new Set<string>();
	for (const color of colors) {
		if (snappedByColor.has(color)) {
			continue;
		}
		const nearest = nearestPainted(color, painted, taken);
		if (nearest) {
			taken.add(nearest);
		}
		snappedByColor.set(color, nearest ?? color);
	}
	return colors.map((color) => snappedByColor.get(color) ?? color);
}

function nearestPainted(color: string, painted: string[], taken: Set<string>): string | null {
	let nearest: string | null = null;
	let nearestDelta = SNAP_MAX_DELTA;
	for (const candidate of painted) {
		if (taken.has(candidate)) {
			continue;
		}
		const delta = deltaE(candidate, color);
		if (delta <= nearestDelta) {
			nearest = candidate;
			nearestDelta = delta;
		}
	}
	return nearest;
}

/** Exact colours covering a meaningful share of the image, most painted first. */
async function paintedColors(image: { data: Uint8Array }): Promise<string[]> {
	const { data } = await decodeImage(image.data);
	const counts = new Map<string, number>();
	let total = 0;
	for (let index = 0; index < data.length; index += 4) {
		if (data[index + 3] < OPAQUE_ALPHA) {
			continue;
		}
		const hex = rgb255ToHex([data[index], data[index + 1], data[index + 2]]);
		counts.set(hex, (counts.get(hex) ?? 0) + 1);
		total++;
	}
	return [...counts.entries()]
		.filter(([, count]) => count / total >= SNAP_MIN_SHARE)
		.sort((a, b) => b[1] - a[1])
		.slice(0, SNAP_MAX_CANDIDATES)
		.map(([hex]) => hex);
}

function asColorCandidate(color: Color): ColorCandidate {
	return { hex: color.hex(), count: Math.round(color.proportion * 10_000), properties: ['pixels'] };
}

/** ColorThief's Vibrant roles are the library stand-in for saturated minority colours. */
function accentCandidates(palette: Color[]): ColorCandidate[] {
	const swatches = classifySwatches(palette);
	return [swatches.Vibrant, swatches.DarkVibrant, swatches.LightVibrant]
		.filter((swatch) => swatch !== null)
		.map((swatch) => asColorCandidate(swatch.color));
}

/** sharp is a native addon shipped next to the standalone binary, so it is loaded on first use to keep startup independent of it. */
async function decodeImage(data: Uint8Array): Promise<Bitmap> {
	const { default: sharp } = await import('sharp');
	const { data: pixels, info } = await sharp(Buffer.from(data), { failOn: 'error' })
		.rotate()
		.resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data: pixels, width: info.width, height: info.height };
}

function detectDocumentGround(bitmap: Bitmap): DocumentGround | null {
	const { data, width, height } = bitmap;
	if (width < 16 || height < 16) {
		return null;
	}

	const average = (x0: number, y0: number, x1: number, y1: number): [number, number, number] | null => {
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;
		const left = Math.max(0, Math.floor(x0));
		const top = Math.max(0, Math.floor(y0));
		const right = Math.min(width, Math.ceil(x1));
		const bottom = Math.min(height, Math.ceil(y1));
		for (let y = top; y < bottom; y += 2) {
			for (let x = left; x < right; x += 2) {
				const i = (y * width + x) * 4;
				if (data[i + 3] < 128) {
					continue;
				}
				r += data[i];
				g += data[i + 1];
				b += data[i + 2];
				n++;
			}
		}
		return n === 0 ? null : [r / n, g / n, b / n];
	};

	const insetX = width * 0.25;
	const insetY = height * 0.25;
	const center = average(insetX, insetY, width - insetX, height - insetY);
	const cornerSizeX = width * 0.12;
	const cornerSizeY = height * 0.12;
	const corners = [
		average(0, 0, cornerSizeX, cornerSizeY),
		average(width - cornerSizeX, 0, width, cornerSizeY),
		average(0, height - cornerSizeY, cornerSizeX, height),
		average(width - cornerSizeX, height - cornerSizeY, width, height),
	];
	if (!center || corners.some((corner) => !corner)) {
		return null;
	}

	const cornerRgb = corners.map((corner) => corner as [number, number, number]);
	const cornerMean: [number, number, number] = [0, 0, 0];
	for (const rgb of cornerRgb) {
		cornerMean[0] += rgb[0] / cornerRgb.length;
		cornerMean[1] += rgb[1] / cornerRgb.length;
		cornerMean[2] += rgb[2] / cornerRgb.length;
	}
	const maxCornerGap = Math.max(
		...cornerRgb.map((rgb) => Math.hypot(rgb[0] - cornerMean[0], rgb[1] - cornerMean[1], rgb[2] - cornerMean[2])),
	);
	const centerHex = rgb255ToHex(center);
	const cornerHex = rgb255ToHex(cornerMean);
	return {
		center: centerHex,
		shellDetected:
			maxCornerGap < CORNER_AGREE_RGB &&
			relativeLuminance(cornerHex) < SHELL_CORNER_LUM &&
			relativeLuminance(centerHex) - relativeLuminance(cornerHex) > SHELL_CENTER_LIFT,
	};
}

function rgb255ToHex([r, g, b]: [number, number, number]): string {
	return rgbToHex([r / 255, g / 255, b / 255]);
}
