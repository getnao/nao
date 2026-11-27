import type { DateFormatSettings } from '@nao/shared/date';
import type { StoryThemePair } from '@nao/shared/story-theme';
import type { StoryDownloadFormat } from '@nao/shared/types';

import { generateStoryHtml } from './story-html';
import { generateStoryMarkdown } from './story-markdown';
import { generateStoryPdf } from './story-pdf';

export type QueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;

export interface StoryInput {
	title: string;
	code: string;
}

const MIME_TYPES: Record<StoryDownloadFormat, string> = {
	pdf: 'application/pdf',
	html: 'text/html',
	markdown: 'text/markdown',
};

const FILE_EXTENSIONS: Record<StoryDownloadFormat, string> = {
	pdf: 'pdf',
	html: 'html',
	markdown: 'md',
};

export async function buildStoryDownloadFile(
	format: StoryDownloadFormat,
	title: string,
	code: string,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	theme?: StoryThemePair | null,
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
	const story = { title, code };
	const buffer = await generateStoryBuffer(format, story, queryData, dateFormat, theme);
	return {
		buffer,
		filename: formatDownloadFilename(title, format),
		mimeType: MIME_TYPES[format],
	};
}

export async function buildDownloadResponse(
	format: StoryDownloadFormat,
	title: string,
	code: string,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	theme?: StoryThemePair | null,
): Promise<{ data: string; filename: string; mimeType: string }> {
	const { buffer, filename, mimeType } = await buildStoryDownloadFile(
		format,
		title,
		code,
		queryData,
		dateFormat,
		theme,
	);
	return {
		data: buffer.toString('base64'),
		filename,
		mimeType,
	};
}

async function generateStoryBuffer(
	format: StoryDownloadFormat,
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat: DateFormatSettings | null | undefined,
	theme: StoryThemePair | null | undefined,
): Promise<Buffer> {
	switch (format) {
		case 'pdf':
			return generateStoryPdf(story, queryData, dateFormat, theme);
		case 'html':
			return Buffer.from(await generateStoryHtml(story, queryData, dateFormat, undefined, { theme }));
		case 'markdown':
			return Buffer.from(await generateStoryMarkdown(story, queryData, dateFormat, theme));
	}
}

export function formatDownloadFilename(title: string, format: StoryDownloadFormat): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
	const date = new Date().toISOString().slice(0, 10);
	return `${slug}-${date}.${FILE_EXTENSIONS[format]}`;
}
