import { env } from '../env';

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

function appUrl(path: string): string {
	const base = env.BETTER_AUTH_URL.replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}
