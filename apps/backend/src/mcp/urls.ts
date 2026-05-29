import type { DownloadFormat } from '@nao/shared/types';

import { env } from '../env';
import { generateEmbedToken } from '../utils/embed-token';

export function chatUrl(chatId: string): string {
	return appUrl(`/${chatId}`);
}

export function storyUrl(story: { id: string; chatId: string | null; slug: string }): string {
	if (story.chatId) {
		return appUrl(`/stories/preview/${story.chatId}/${story.slug}`);
	}
	return appUrl(`/stories/standalone/${story.id}`);
}

export function storyChatUrl(story: { chatId: string | null }): string | null {
	return story.chatId ? chatUrl(story.chatId) : null;
}

export function storyEmbedUrl(storyId: string, projectId: string): string {
	const token = generateEmbedToken('story', storyId, projectId);
	return storyEmbedUrlWithToken(storyId, token);
}

export function storyEmbedUrls(
	storyId: string,
	projectId: string,
): { embedUrl: string; pdfUrl: string; htmlUrl: string } {
	const token = generateEmbedToken('story', storyId, projectId);
	return {
		embedUrl: storyEmbedUrlWithToken(storyId, token),
		pdfUrl: storyEmbedDownloadUrlWithToken(storyId, token, 'pdf'),
		htmlUrl: storyEmbedDownloadUrlWithToken(storyId, token, 'html'),
	};
}

export function storyEmbedDownloadUrl(storyId: string, projectId: string, format: DownloadFormat): string {
	const token = generateEmbedToken('story', storyId, projectId);
	return storyEmbedDownloadUrlWithToken(storyId, token, format);
}

function storyEmbedUrlWithToken(storyId: string, token: string): string {
	return appUrl(`/embed/story/${storyId}?token=${encodeURIComponent(token)}`);
}

function storyEmbedDownloadUrlWithToken(storyId: string, token: string, format: DownloadFormat): string {
	const q = new URLSearchParams({ token, format });
	return appUrl(`/api/embed/story/${encodeURIComponent(storyId)}/download?${q.toString()}`);
}

export function chartEmbedUrl(chartEmbedId: string, projectId: string): string {
	const token = generateEmbedToken('chart', chartEmbedId, projectId);
	return appUrl(`/embed/chart/${chartEmbedId}?token=${encodeURIComponent(token)}`);
}

function appUrl(path: string): string {
	const base = env.BETTER_AUTH_URL.replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}
