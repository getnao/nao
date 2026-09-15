import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { CHART_EMBEDDED_FONT_FAMILY } from '@nao/shared';
import { Resvg } from '@resvg/resvg-js';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { generateChartImage, renderChartToSvg } from '../src/components/generate-chart';
import { chartFontFiles } from '../src/utils/chart-fonts';
import { resolveCssVariables } from '../src/utils/generate-chart';

const CHART_INPUT = {
	config: {
		query_id: 'q1',
		chart_type: 'bar' as const,
		x_axis_key: 'week',
		x_axis_type: 'category' as const,
		series: [{ data_key: 'amount', label: 'Facturation estimée TTC' }],
		title: 'Projection hebdomadaire',
		y_axis_label: 'Montant TTC (€)',
		show_data_labels: true,
	},
	data: [
		{ week: '14/09/2026', amount: 43000 },
		{ week: '28/09/2026', amount: 16000 },
		{ week: '12/10/2026', amount: 15000 },
	],
};

/**
 * Recharts exposes the family as a `font-family` attribute on ticks, but folds
 * an axis label's props into `style`. resvg honours both, so assert on either.
 */
function declaredFontFamilies(svg: string): string[] {
	const $ = cheerio.load(svg, { xmlMode: true });
	return $('text')
		.toArray()
		.map((node) => $(node).attr('font-family') ?? $(node).attr('style') ?? '');
}

/** Non-ASCII glyphs reach the markup as XML entities, so compare decoded text. */
function renderedText(svg: string): string {
	const $ = cheerio.load(svg, { xmlMode: true });
	return $('text').text();
}

function renderWithoutSystemFonts(svg: string): Buffer {
	const resvg = new Resvg(resolveCssVariables(svg), {
		fitTo: { mode: 'zoom' as const, value: 2 },
		font: {
			fontFiles: chartFontFiles,
			defaultFontFamily: CHART_EMBEDDED_FONT_FAMILY,
			sansSerifFamily: CHART_EMBEDDED_FONT_FAMILY,
			loadSystemFonts: false,
		},
	});
	return Buffer.from(resvg.render().asPng());
}

/**
 * Counts non-white pixels in a bottom-right region of the PNG, which holds the
 * legend label and no chart furniture. Decoded with zlib alone to keep the
 * suite free of an image dependency.
 */
function countInkPixels(png: Buffer, region: { fromWidthRatio: number; fromHeightRatio: number }): number {
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	const pixels = decodeRgba(png, width, height);

	let ink = 0;
	for (let y = Math.floor(height * region.fromHeightRatio); y < height; y += 1) {
		for (let x = Math.floor(width * region.fromWidthRatio); x < width; x += 1) {
			const offset = (y * width + x) * 4;
			const isOpaque = pixels[offset + 3] > 16;
			const isDark = pixels[offset] < 240 || pixels[offset + 1] < 240 || pixels[offset + 2] < 240;
			if (isOpaque && isDark) {
				ink += 1;
			}
		}
	}
	return ink;
}

function decodeRgba(png: Buffer, width: number, height: number): Buffer {
	const chunks: Buffer[] = [];
	let cursor = 8;
	while (cursor < png.length) {
		const length = png.readUInt32BE(cursor);
		if (png.toString('ascii', cursor + 4, cursor + 8) === 'IDAT') {
			chunks.push(png.subarray(cursor + 8, cursor + 8 + length));
		}
		cursor += 12 + length;
	}

	const raw = inflateSync(Buffer.concat(chunks));
	const pixels = Buffer.alloc(width * height * 4);
	const stride = width * 4;
	let position = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = raw[position];
		position += 1;
		const line = raw.subarray(position, position + stride);
		position += stride;
		const row = pixels.subarray(y * stride, (y + 1) * stride);
		const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
		for (let x = 0; x < stride; x += 1) {
			const left = x >= 4 ? row[x - 4] : 0;
			const up = previous[x];
			const upLeft = x >= 4 ? previous[x - 4] : 0;
			row[x] = (line[x] + unfilterByte(filter, left, up, upLeft)) & 0xff;
		}
	}
	return pixels;
}

function unfilterByte(filter: number, left: number, up: number, upLeft: number): number {
	switch (filter) {
		case 0:
			return 0;
		case 1:
			return left;
		case 2:
			return up;
		case 3:
			return Math.floor((left + up) / 2);
		case 4:
			return paethPredictor(left, up, upLeft);
		default:
			throw new Error(`Unsupported PNG filter: ${filter}`);
	}
}

function paethPredictor(left: number, up: number, upLeft: number): number {
	const estimate = left + up - upLeft;
	const distanceLeft = Math.abs(estimate - left);
	const distanceUp = Math.abs(estimate - up);
	const distanceUpLeft = Math.abs(estimate - upLeft);
	if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
		return left;
	}
	return distanceUp <= distanceUpLeft ? up : upLeft;
}

describe('chart SVG fonts', () => {
	it('gives every text node a font family resvg can resolve', () => {
		const families = declaredFontFamilies(renderChartToSvg(CHART_INPUT));

		expect(families.length).toBeGreaterThan(0);
		for (const family of families) {
			expect(family).toContain('DejaVu Sans');
		}
	});

	it('never falls back to system-ui alone, which resvg cannot match', () => {
		const svg = renderChartToSvg(CHART_INPUT);

		expect(svg).not.toContain('"system-ui, sans-serif"');
		expect(svg).not.toContain("'system-ui, sans-serif'");
	});

	it('renders the title, the axis label and the category labels', () => {
		const text = renderedText(renderChartToSvg(CHART_INPUT));

		expect(text).toContain('Projection hebdomadaire');
		expect(text).toContain('Montant TTC (€)');
		expect(text).toContain('14/09/2026');
	});
});

describe('bundled font files', () => {
	it('ships both faces, since the title needs bold', () => {
		expect(chartFontFiles).toHaveLength(2);
		expect(chartFontFiles.some((path) => path.endsWith('DejaVuSans.ttf'))).toBe(true);
		expect(chartFontFiles.some((path) => path.endsWith('DejaVuSans-Bold.ttf'))).toBe(true);
	});

	it('resolves to files that exist on disk', () => {
		for (const path of chartFontFiles) {
			expect(existsSync(path)).toBe(true);
		}
	});
});

const LEGEND_REGION = { fromWidthRatio: 0.42, fromHeightRatio: 0.955 };

describe('rasterised chart PNG', () => {
	it('draws glyphs, not just shapes', () => {
		const png = generateChartImage(CHART_INPUT);

		expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		expect(countInkPixels(png, LEGEND_REGION)).toBeGreaterThan(200);
	});

	/**
	 * The bug only ever showed on hosts carrying no font, so the assertion above
	 * would keep passing on a developer machine even with the bundle removed.
	 * Rasterising with system fonts denied is what actually pins the fix.
	 */
	it('still draws glyphs on a host that offers no font of its own', () => {
		const png = renderWithoutSystemFonts(renderChartToSvg(CHART_INPUT));

		expect(countInkPixels(png, LEGEND_REGION)).toBeGreaterThan(200);
	});
});

describe('resolveCssVariables', () => {
	it('substitutes the fallback so resvg does not drop the declared colour', () => {
		expect(resolveCssVariables('<text fill="var(--foreground, #111827)">x</text>')).toBe(
			'<text fill="#111827">x</text>',
		);
	});

	it('leaves a chart SVG free of custom properties', () => {
		expect(resolveCssVariables(renderChartToSvg(CHART_INPUT))).not.toContain('var(--');
	});

	it('keeps markup without custom properties untouched', () => {
		expect(resolveCssVariables('<text fill="#6b7280">x</text>')).toBe('<text fill="#6b7280">x</text>');
	});

	it('leaves chart text alone, since a title may legitimately mention var()', () => {
		const markup = '<text>Cost of var(--foo, 12px) in 2026</text>';

		expect(resolveCssVariables(markup)).toBe(markup);
	});

	it('resolves a fallback that is itself a function', () => {
		expect(resolveCssVariables('<text fill="var(--c, rgb(17,24,39))">x</text>')).toBe(
			'<text fill="rgb(17,24,39)">x</text>',
		);
	});

	it('resolves nested variables down to the innermost fallback', () => {
		expect(resolveCssVariables('<text fill="var(--a, var(--b, #abc))">x</text>')).toBe(
			'<text fill="#abc">x</text>',
		);
	});

	it('resolves every declaration inside a style attribute', () => {
		expect(resolveCssVariables('<text style="fill:var(--a, #111);stroke:var(--b, #222)">x</text>')).toBe(
			'<text style="fill:#111;stroke:#222">x</text>',
		);
	});

	it('keeps a variable that declares no fallback, having nothing to substitute', () => {
		expect(resolveCssVariables('<text fill="var(--only)">x</text>')).toBe('<text fill="var(--only)">x</text>');
	});
});
