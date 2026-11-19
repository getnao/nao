import { createHash } from 'node:crypto';

import type { DateFormatSettings } from '@nao/shared/date';
import { type ParsedTableBlock, type Segment, splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, formatColumnLabel } from '@nao/shared/story-table-utils';
import { flattenStoryTabs } from '@nao/shared/story-tabs';
import type { StoryThemePair } from '@nao/shared/story-theme';

import { env } from '../env';
import { saveChart } from '../queries/chart-image';
import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryEmailHtml } from './story-html';

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

async function visualToMarkdown(segment: VisualSegment, context: MarkdownContext): Promise<string> {
	const block = segment.type === 'chart' ? segment.chart : segment.map;
	const imageUrl = await renderVisualImage(block.rawTag, context);
	const image = imageUrl
		? `![${escapeImageAlt(block.title || segment.type)}](${imageUrl})`
		: `_${segment.type === 'chart' ? 'Chart' : 'Map'} unavailable._`;
	return joinBlocks(formatSectionTitle(block.title), image);
}

/** Reuses the email renderer, which draws a single chart or map to a PNG without a headless browser. */
async function renderVisualImage(code: string | undefined, context: MarkdownContext): Promise<string | null> {
	if (!code) {
		return null;
	}
	try {
		const { images } = await generateStoryEmailHtml(
			{ title: '', code },
			context.queryData,
			context.dateFormat,
			undefined,
			context.theme,
		);
		return images[0] ? await publishImage(images[0].content) : null;
	} catch {
		return null;
	}
}

/** Images are keyed by their content, so exporting the same story again reuses the stored ones. */
async function publishImage(png: Buffer | string): Promise<string> {
	const data = Buffer.from(png).toString('base64');
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
