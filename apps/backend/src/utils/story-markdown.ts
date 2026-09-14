import type { DateFormatSettings } from '@nao/shared/date';
import { type ParsedTableBlock, type Segment, splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, formatColumnLabel } from '@nao/shared/story-table-utils';
import { flattenStoryTabs } from '@nao/shared/story-tabs';

import { env } from '../env';
import { saveClipboardChart } from '../queries/chart-image';
import { getBrowser } from './headless-browser';
import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryHtml } from './story-html';

const A4_PRINTABLE_WIDTH_PX = 714;
const A4_PRINTABLE_HEIGHT_PX = 1043;

type VisualSegment = Extract<Segment, { type: 'map' | 'chart' }>;

export interface StoryMarkdownOptions {
	clipboardChartUrls?: boolean;
}

export async function generateStoryMarkdown(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	options: StoryMarkdownOptions = {},
): Promise<string> {
	const segments = splitCodeIntoSegments(flattenStoryTabs(story.code));
	const visualSegments = collectVisualSegments(segments);
	const visualImages = await captureVisuals(visualSegments, queryData, dateFormat, options);
	const sections = segments.flatMap((s) => segmentToMarkdown(s, queryData, visualImages, dateFormat));

	const title = story.title.trim();
	return [title ? `# ${title.replace(/\r?\n/g, ' ')}` : '', ...sections].filter(Boolean).join('\n\n');
}

function collectVisualSegments(segments: Segment[]): VisualSegment[] {
	return segments.flatMap((s): VisualSegment[] => {
		if (s.type === 'map' || s.type === 'chart') {
			return [s];
		}
		if (s.type === 'grid') {
			return collectVisualSegments(s.children);
		}
		return [];
	});
}

async function captureVisuals(
	segments: VisualSegment[],
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	options: StoryMarkdownOptions = {},
): Promise<Map<string, string>> {
	const uniqueSegments = deduplicateSegments(segments);
	if (uniqueSegments.length === 0) {
		return new Map<string, string>();
	}

	const browser = await getBrowser();
	const page = await browser.newPage();
	const images = new Map<string, string>();

	try {
		await page.emulateMediaType('print');
		await page.setViewport({
			width: A4_PRINTABLE_WIDTH_PX,
			height: A4_PRINTABLE_HEIGHT_PX,
			deviceScaleFactor: 2,
		});
		for (const segment of uniqueSegments) {
			const image = await captureVisual(page, segment, queryData, dateFormat, options);
			if (image) {
				images.set(visualSegmentId(segment), image);
			}
		}
	} finally {
		await page.close();
	}
	return images;
}

function deduplicateSegments(segments: VisualSegment[]): VisualSegment[] {
	const uniqueSegments = new Map<string, VisualSegment>();
	for (const segment of segments) {
		uniqueSegments.set(visualSegmentId(segment), segment);
	}
	return [...uniqueSegments.values()];
}

async function captureVisual(
	page: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newPage']>>,
	segment: VisualSegment,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	options: StoryMarkdownOptions = {},
): Promise<string | null> {
	const code = visualSegmentId(segment);
	const html = await generateStoryHtml({ title: visualSegmentTitle(segment), code }, queryData, dateFormat);

	try {
		await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
		if (segment.type === 'map') {
			await page.waitForFunction('window.__naoMapsReady === true', { timeout: 15000 }).catch(() => undefined);
		}
		const visual = await page.$('body > div:first-of-type');
		if (!visual) {
			return null;
		}
		const screenshot = await visual.screenshot({ type: 'png' });

		return formatVisualImage(segment, Buffer.from(screenshot), options);
	} catch {
		return null;
	}
}

async function formatVisualImage(
	segment: VisualSegment,
	image: Buffer,
	options: StoryMarkdownOptions,
): Promise<string> {
	if ((segment.type !== 'chart' && segment.type !== 'map') || !options.clipboardChartUrls) {
		return `data:image/png;base64,${image.toString('base64')}`;
	}
	const chartId = await saveClipboardChart(image.toString('base64'));
	return new URL(`/c/clipboard/${chartId}.png`, env.BETTER_AUTH_URL).toString();
}

function visualSegmentId(segment: VisualSegment): string {
	const block = segment.type === 'chart' ? segment.chart : segment.map;
	return block.rawTag ?? '';
}

function visualSegmentTitle(segment: VisualSegment): string {
	return segment.type === 'chart' ? segment.chart.title : segment.map.title;
}

function segmentToMarkdown(
	segment: Segment,
	queryData: QueryDataMap | null,
	visualImages: Map<string, string>,
	dateFormat?: DateFormatSettings | null,
): string[] {
	switch (segment.type) {
		case 'markdown':
			return [segment.content];
		case 'table':
			return [tableToMarkdown(segment.table, queryData, dateFormat)];
		case 'chart':
		case 'map':
			return [visualToMarkdown(segment, visualImages)];
		case 'grid':
			return segment.children.flatMap((s) => segmentToMarkdown(s, queryData, visualImages, dateFormat));
		case 'filter':
			return [];
	}
}

function visualToMarkdown(segment: VisualSegment, visualImages: Map<string, string>): string {
	const title = visualSegmentTitle(segment);
	const sectionTitle = formatSectionTitle(title);
	const image = visualImages.get(visualSegmentId(segment));
	const content = image
		? `![${escapeImageAlt(title || segment.type)}](${image})`
		: `_${capitalize(segment.type)} unavailable._`;
	return [sectionTitle, content].filter(Boolean).join('\n\n');
}

function tableToMarkdown(
	table: ParsedTableBlock,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
): string {
	const query = queryData?.[table.queryId];
	const title = formatSectionTitle(table.title);
	if (!query || query.columns.length === 0) {
		return [title, '_Table data unavailable._'].filter(Boolean).join('\n\n');
	}
	const rows = query.data as Record<string, unknown>[];
	const headerLine = markdownTableRow(query.columns.map(formatColumnLabel));
	const separatorLine = markdownTableRow(query.columns.map(() => '---'));
	const rowLines = rows.map((row) =>
		markdownTableRow(query.columns.map((column) => formatCellValue(row[column], dateFormat))),
	);
	return [title, [headerLine, separatorLine, ...rowLines].join('\n')].filter(Boolean).join('\n\n');
}

function markdownTableRow(values: string[]): string {
	return `| ${values.map(escapeTableCell).join(' | ')} |`;
}
function escapeTableCell(value: string): string {
	return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}
function formatSectionTitle(title: string): string {
	return title ? `**${title.replace(/\r?\n/g, ' ')}**` : '';
}
function escapeImageAlt(value: string): string {
	return value.replace(/[[\]\\]/g, '\\$&').replace(/\r?\n/g, ' ');
}
function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
