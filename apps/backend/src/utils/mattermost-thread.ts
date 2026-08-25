import type { MattermostAdapter } from 'chat-adapter-mattermost';

export type MattermostPostPlacement = {
	id: string;
	channel_id: string;
	root_id?: string;
};

export function resolveMattermostThreadId(
	adapter: MattermostAdapter,
	post: MattermostPostPlacement,
	isDirectMessage: boolean,
): string {
	const rootPostId = isDirectMessage && !post.root_id ? undefined : post.root_id || post.id;
	return adapter.encodeThreadId({ channelId: post.channel_id, rootPostId });
}
