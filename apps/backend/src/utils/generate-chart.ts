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

export function createSvg(html: string, width: number, height: number, legend: LegendEntry[]): string {
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

export function svgToPng(svg: string): Buffer {
	const resvg = new Resvg(svg, {
		fitTo: { mode: 'zoom' as const, value: 2 },
		font: { loadSystemFonts: true },
	});
	return Buffer.from(resvg.render().asPng());
}
