import type { DownloadFormat } from '@nao/shared/types';

import { generateStoryHtml } from './story-html';
import { generateStoryPdf } from './story-pdf';

export type QueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;

export interface StoryInput {
	title: string;
	code: string;
}

const MIME_TYPES: Record<DownloadFormat, string> = {
	pdf: 'application/pdf',
	html: 'text/html',
};

export async function buildDownloadResponse(
	format: DownloadFormat,
	title: string,
	code: string,
	queryData: QueryDataMap | null,
): Promise<{ data: string; filename: string; mimeType: string }> {
	const story = { title, code };
	const buffer = await generateStoryBuffer(format, story, queryData);

	return {
		data: buffer.toString('base64'),
		filename: formatDownloadFilename(title, format),
		mimeType: MIME_TYPES[format],
	};
}

async function generateStoryBuffer(
	format: DownloadFormat,
	story: StoryInput,
	queryData: QueryDataMap | null,
): Promise<Buffer> {
	switch (format) {
		case 'pdf':
			return generateStoryPdf(story, queryData);
		case 'html':
			return Buffer.from(generateStoryHtml(story, queryData));
	}
}

function formatDownloadFilename(title: string, format: DownloadFormat): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
	const date = new Date().toISOString().slice(0, 10);
	return `${slug}-${date}.${format}`;
}
