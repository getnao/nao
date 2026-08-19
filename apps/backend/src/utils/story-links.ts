export function sharedStoryPath(shareId: string): string {
	return `/stories/shared/${shareId}`;
}

export function standaloneStoryPath(storyId: string): string {
	return `/stories/standalone/${storyId}`;
}

export function storyPath(share: { id: string } | null, storyId: string): string {
	return share ? sharedStoryPath(share.id) : standaloneStoryPath(storyId);
}
