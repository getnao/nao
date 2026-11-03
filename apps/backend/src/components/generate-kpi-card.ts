import { formatChartValue } from '@nao/shared/chart-values';
import type { displayChart } from '@nao/shared/tools';

import { svgToPng } from '../utils/generate-chart';
import { DEFAULT_EXPORT_PALETTE, type StoryExportPalette } from '../utils/story-export-palette';

const PADDING = 28;
const TITLE_HEIGHT = 40;
const TILE_HEIGHT = 120;
const TILE_GAP = 16;
const TILE_INNER_PADDING = 20;
const VALUE_MAX_FONT_SIZE = 44;
/** Average width of a bold digit relative to the font size, used to shrink long values to fit their tile. */
const VALUE_CHARACTER_WIDTH_RATIO = 0.62;

/** Draws a KPI card (each series' value from the first row) as a PNG, for chat apps that can only show images. */
export function generateKpiCardImage(input: {
	config: displayChart.KpiCardInput;
	rows: Record<string, unknown>[];
	width?: number;
	palette?: StoryExportPalette;
}): Buffer {
	const palette = input.palette ?? DEFAULT_EXPORT_PALETTE;
	return svgToPng(renderKpiCardToSvg(input.config, input.rows, input.width ?? 560, palette), 2);
}

function renderKpiCardToSvg(
	config: displayChart.KpiCardInput,
	rows: Record<string, unknown>[],
	width: number,
	palette: StoryExportPalette,
): string {
	const firstRow = rows[0] ?? {};
	const titleHeight = config.title ? TITLE_HEIGHT : 0;
	const tileWidth = (width - PADDING * 2 - TILE_GAP * (config.series.length - 1)) / config.series.length;
	const height = PADDING * 2 + titleHeight + TILE_HEIGHT;

	const title = config.title
		? `<text x="${PADDING}" y="${PADDING + 18}" font-size="18" font-weight="700" fill="${palette.heading}">${escapeXml(config.title)}</text>`
		: '';
	const tiles = config.series.map((series, index) => {
		const x = PADDING + index * (tileWidth + TILE_GAP);
		const y = PADDING + titleHeight;
		const label = series.label || series.data_key;
		const value = formatKpiValue(firstRow[series.data_key], series.value_format);
		const fontSize = fitValueFontSize(value, tileWidth - TILE_INNER_PADDING * 2);
		return [
			`<rect x="${x}" y="${y}" width="${tileWidth}" height="${TILE_HEIGHT}" rx="12" fill="${palette.sunken}" stroke="${palette.border}"/>`,
			`<text x="${x + TILE_INNER_PADDING}" y="${y + 36}" font-size="16" fill="${palette.muted}">${escapeXml(label)}</text>`,
			`<text x="${x + TILE_INNER_PADDING}" y="${y + 92}" font-size="${fontSize}" font-weight="700" fill="${palette.heading}">${escapeXml(value)}</text>`,
		].join('');
	});

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<rect width="${width}" height="${height}" fill="${palette.page}"/>`,
		title,
		...tiles,
		'</svg>',
	].join('');
}

function fitValueFontSize(value: string, availableWidth: number): number {
	const fittingSize = availableWidth / (Array.from(value).length * VALUE_CHARACTER_WIDTH_RATIO);
	return Math.floor(Math.min(VALUE_MAX_FONT_SIZE, fittingSize));
}

function formatKpiValue(value: unknown, valueFormat: displayChart.ValueFormat | undefined): string {
	if (typeof value === 'number') {
		return formatChartValue(value, valueFormat);
	}
	return value === null || value === undefined ? '–' : String(value);
}

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
