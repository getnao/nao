import * as projectQueries from '../queries/project.queries';
import type { EmailAttachment } from '../types/email';
import { logger } from './logger';
import { buildStoryDownloadFile, type QueryDataMap } from './story-download';
import { generateStoryEmailHtml, type StoryEmailHtml } from './story-html';

export async function buildStoryPdfAttachment(
	title: string,
	code: string,
	queryData: QueryDataMap,
	projectId: string,
): Promise<EmailAttachment[]> {
	try {
		const displaySettings = await projectQueries.getDisplaySettings(projectId);
		const file = await buildStoryDownloadFile('pdf', title, code, queryData, displaySettings?.dateFormat);
		return [{ filename: file.filename, content: file.buffer, contentType: file.mimeType }];
	} catch (error) {
		logger.error(`Failed to build story PDF attachment: ${String(error)}`, { source: 'system', projectId });
		return [];
	}
}

export async function buildStoryEmailHtml(
	title: string,
	code: string,
	queryData: QueryDataMap,
	projectId: string,
): Promise<StoryEmailHtml | undefined> {
	try {
		const displaySettings = await projectQueries.getDisplaySettings(projectId);
		return await generateStoryEmailHtml({ title, code }, queryData, displaySettings?.dateFormat);
	} catch (error) {
		logger.error(`Failed to build story email HTML: ${String(error)}`, { source: 'system', projectId });
		return undefined;
	}
}
