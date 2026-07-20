import { Resvg } from '@resvg/resvg-js';
import * as cheerio from 'cheerio';

function extractSvgFromHTML(html: string): string {
	const $ = cheerio.load(html, { xmlMode: true });
	const svg = $.xml($('svg'));
	if (!svg) {
		throw new Error('Recharts did not render SVG content');
	}
	return svg;
}

export interface LegendEntry {
	label: string;
	color: string;
}

export type LegendLayout = 'horizontal' | 'vertical';

/** Width reserved on the right for a vertical (pie/donut) legend. */
export const VERTICAL_LEGEND_WIDTH = 200;

export function createSvg(
	html: string,
	width: number,
	height: number,
	legend: LegendEntry[],
	legendLayout: LegendLayout = 'horizontal',
): string {
	if (legendLayout === 'vertical') {
		return createSvgWithRightLegend(html, width, height, legend);
	}

	const legendHeight = legend.length > 0 ? 24 : 0;
	const totalHeight = height + legendHeight;

	const $ = cheerio.load(extractSvgFromHTML(html), { xmlMode: true });
	const $svg = $('svg');

	$svg.attr({
		xmlns: 'http://www.w3.org/2000/svg',
		width: String(width),
		height: String(totalHeight),
		viewBox: `0 0 ${width} ${totalHeight}`,
	});
	$svg.prepend(`<rect width="${width}" height="${totalHeight}" fill="white"/>`);

	if (legend.length > 0) {
		$svg.append(buildLegend(legend, width, height + legendHeight / 2));
	}

	return $.xml($svg);
}

function createSvgWithRightLegend(html: string, width: number, height: number, legend: LegendEntry[]): string {
	const totalWidth = width + VERTICAL_LEGEND_WIDTH;

	const $ = cheerio.load(extractSvgFromHTML(html), { xmlMode: true });
	const $svg = $('svg');

	$svg.attr({
		xmlns: 'http://www.w3.org/2000/svg',
		width: String(totalWidth),
		height: String(height),
		viewBox: `0 0 ${totalWidth} ${height}`,
	});
	$svg.prepend(`<rect width="${totalWidth}" height="${height}" fill="white"/>`);

	if (legend.length > 0) {
		$svg.append(buildVerticalLegend(legend, width + 12, totalWidth, height));
	}

	return $.xml($svg);
}

function buildLegend(entries: LegendEntry[], width: number, centerY: number): string {
	const swatchSize = 10;
	const gap = 6;
	const itemSpacing = 16;
	const charWidth = 7;

	const totalWidth = entries.reduce(
		(sum, e, i) => sum + swatchSize + gap + e.label.length * charWidth + (i < entries.length - 1 ? itemSpacing : 0),
		0,
	);
	let x = (width - totalWidth) / 2;

	const items = entries.map((entry) => {
		const swatch = `<rect x="${x}" y="${centerY - swatchSize / 2}" width="${swatchSize}" height="${swatchSize}" rx="2" fill="${entry.color}"/>`;
		const label = cheerio
			.load('<text/>', { xmlMode: true })('text')
			.attr({
				x: String(x + swatchSize + gap),
				y: String(centerY),
				'dominant-baseline': 'middle',
				'font-size': '12',
				'font-weight': '300',
				'font-family': 'system-ui, sans-serif',
				fill: '#6b7280',
			})
			.text(entry.label)
			.toString();
		x += swatchSize + gap + entry.label.length * charWidth + itemSpacing;
		return swatch + label;
	});

	return `<g>${items.join('')}</g>`;
}

function buildVerticalLegend(entries: LegendEntry[], xOffset: number, rightEdge: number, height: number): string {
	const swatchSize = 10;
	const gap = 6;
	const lineHeight = 22;
	const charWidth = 7;
	const rightPadding = 12;

	const textX = xOffset + swatchSize + gap;
	const maxChars = Math.max(1, Math.floor((rightEdge - textX - rightPadding) / charWidth));

	const totalHeight = entries.length * lineHeight;
	let y = (height - totalHeight) / 2 + lineHeight / 2;

	const items = entries.map((entry) => {
		const swatch = `<rect x="${xOffset}" y="${y - swatchSize / 2}" width="${swatchSize}" height="${swatchSize}" rx="2" fill="${entry.color}"/>`;
		const label = cheerio
			.load('<text/>', { xmlMode: true })('text')
			.attr({
				x: String(textX),
				y: String(y),
				'dominant-baseline': 'middle',
				'font-size': '12',
				'font-weight': '300',
				'font-family': 'system-ui, sans-serif',
				fill: '#6b7280',
			})
			.text(truncateLabel(entry.label, maxChars))
			.toString();
		y += lineHeight;
		return swatch + label;
	});

	return `<g>${items.join('')}</g>`;
}

/**
 * Truncates a legend label with an ellipsis so it never overflows the column.
 * Works on code points (not UTF-16 units) so it never splits a surrogate pair
 * (emoji, CJK extensions) into a lone surrogate that would be invalid in SVG.
 */
export function truncateLabel(label: string, maxChars: number): string {
	const codePoints = Array.from(label);
	if (codePoints.length <= maxChars) {
		return label;
	}
	if (maxChars <= 1) {
		return '…';
	}
	return `${codePoints.slice(0, maxChars - 1).join('')}…`;
}

export function svgToPng(svg: string): Buffer {
	const resvg = new Resvg(svg, {
		fitTo: { mode: 'zoom' as const, value: 2 },
		font: { loadSystemFonts: true },
	});
	return Buffer.from(resvg.render().asPng());
}
