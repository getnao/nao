export function sharedStoryPath(shareId: string): string {
	return `/stories/shared/${shareId}`;
}

export function standaloneStoryPath(storyId: string): string {
	return `/stories/standalone/${storyId}`;
}

export function storyPreviewPath(chatId: string, slug: string): string {
	return `/stories/preview/${chatId}/${encodeURIComponent(slug)}`;
}

export function storyPath(
	share: { id: string } | null,
	story: { id: string; chatId: string | null; slug: string },
): string {
	if (share) {
		return sharedStoryPath(share.id);
	}
	return story.chatId ? storyPreviewPath(story.chatId, story.slug) : standaloneStoryPath(story.id);
}
