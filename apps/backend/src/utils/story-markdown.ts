import { createHash } from 'node:crypto';

import type { DateFormatSettings } from '@nao/shared/date';
import {
	type ParsedChartBlock,
	type ParsedTableBlock,
	type Segment,
	splitCodeIntoSegments,
} from '@nao/shared/story-segments';
import { formatCellValue, formatColumnLabel } from '@nao/shared/story-table-utils';
import { flattenStoryTabs } from '@nao/shared/story-tabs';
import type { StoryThemePair } from '@nao/shared/story-theme';

import { env } from '../env';
import { saveChart } from '../queries/chart-image';
import type { QueryDataMap, StoryInput } from './story-download';
import { kpiCardValues, renderStoryVisualImage } from './story-html';

type VisualSegment = Extract<Segment, { type: 'chart' | 'map' }>;

interface MarkdownContext {
	queryData: QueryDataMap | null;
	dateFormat?: DateFormatSettings | null;
	theme?: StoryThemePair | null;
}

const IMAGE_KEY_PREFIX = 'story-markdown:';

/** Charts and maps become PNGs served from public URLs, so the Markdown survives an import into tools like Notion. */
export async function generateStoryMarkdown(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	theme?: StoryThemePair | null,
): Promise<string> {
	const context = { queryData, dateFormat, theme };
	const segments = splitCodeIntoSegments(flattenStoryTabs(story.code));
	const blocks = await Promise.all(segments.map((segment) => segmentToMarkdown(segment, context)));
	return joinBlocks(formatHeading(story.title), ...blocks.flat());
}

async function segmentToMarkdown(segment: Segment, context: MarkdownContext): Promise<string[]> {
	switch (segment.type) {
		case 'markdown':
			return [segment.content.trim()];
		case 'table':
			return [tableToMarkdown(segment.table, context)];
		case 'chart':
			return segment.chart.chartType === 'kpi_card'
				? [kpiToMarkdown(segment.chart, context)]
				: [await visualToMarkdown(segment, context)];
		case 'map':
			return [await visualToMarkdown(segment, context)];
		case 'grid': {
			const children = await Promise.all(segment.children.map((child) => segmentToMarkdown(child, context)));
			return children.flat();
		}
		case 'filter':
			return [];
	}
}

function tableToMarkdown(table: ParsedTableBlock, { queryData, dateFormat }: MarkdownContext): string {
	const query = queryData?.[table.queryId];
	if (!query?.columns.length) {
		return joinBlocks(formatSectionTitle(table.title), '_Table data unavailable._');
	}
	const rows = query.data as Record<string, unknown>[];
	const lines = [
		markdownTableRow(query.columns.map(formatColumnLabel)),
		markdownTableRow(query.columns.map(() => '---')),
		...rows.map((row) => markdownTableRow(query.columns.map((column) => formatCellValue(row[column], dateFormat)))),
	];
	return joinBlocks(formatSectionTitle(table.title), lines.join('\n'));
}

function kpiToMarkdown(chart: ParsedChartBlock, context: MarkdownContext): string {
	const values = kpiCardValues(chart, context.queryData);
	const lines = values.map(({ label, value, comparison }) => {
		const change = comparison ? ` (${comparison.valueText} vs. ${comparison.periodLabel})` : '';
		return `- **${singleLine(label)}**: ${value}${change}`;
	});
	return joinBlocks(formatSectionTitle(chart.title), lines.join('\n') || '_Chart unavailable._');
}

async function visualToMarkdown(segment: VisualSegment, context: MarkdownContext): Promise<string> {
	const title = segment.type === 'chart' ? segment.chart.title : segment.map.title;
	const imageUrl = await renderVisualImage(segment, context);
	const image = imageUrl
		? `![${escapeImageAlt(title || segment.type)}](${imageUrl})`
		: `_${segment.type === 'chart' ? 'Chart' : 'Map'} unavailable._`;
	return joinBlocks(formatSectionTitle(title), image);
}

/** Renders the parsed block rather than its raw tag, so story parameters stay resolved. */
async function renderVisualImage(segment: VisualSegment, context: MarkdownContext): Promise<string | null> {
	try {
		const png = await renderStoryVisualImage(segment, context.queryData, context.dateFormat, context.theme);
		return png ? await publishImage(png) : null;
	} catch {
		return null;
	}
}

/** Images are keyed by their content, so exporting the same story again reuses the stored ones. */
async function publishImage(png: Buffer): Promise<string> {
	const data = png.toString('base64');
	const hash = createHash('sha256').update(data).digest('hex');
	const imageId = await saveChart(`${IMAGE_KEY_PREFIX}${hash}`, data);
	return new URL(`/c/story/${imageId}.png`, env.BETTER_AUTH_URL).toString();
}

function markdownTableRow(values: string[]): string {
	return `| ${values.map(escapeTableCell).join(' | ')} |`;
}

function escapeTableCell(value: string): string {
	return singleLine(value).replace(/\|/g, '\\|');
}

function formatHeading(title: string): string {
	const text = singleLine(title);
	return text ? `# ${text}` : '';
}

function formatSectionTitle(title: string | undefined): string {
	const text = singleLine(title ?? '');
	return text ? `**${text}**` : '';
}

function escapeImageAlt(value: string): string {
	return singleLine(value).replace(/[[\]\\]/g, '\\$&');
}

function singleLine(value: string): string {
	return value.replace(/\s*\r?\n\s*/g, ' ').trim();
}

function joinBlocks(...blocks: string[]): string {
	return blocks.filter(Boolean).join('\n\n');
}
