import type { CustomStoryViewerAccess, StoryStateChange } from '@nao/shared/story-app';
import { trpc, trpcClient } from '@/main';
import { chatActivityStore } from '@/stores/chat-activity';

/** Where a custom story's `useQueryData` calls are answered from: the owner's chat, a share link, or a read-only viewer. */
type CustomStoryOwnerDataSource = { kind: 'owner'; storySlug: string } & (
	| { chatId: string; storyId?: never }
	| { storyId: string; chatId?: never }
);

export type CustomStoryDataSource =
	| CustomStoryOwnerDataSource
	| { kind: 'share'; storyId: string; versionNumber?: number }
	| { kind: 'viewer'; access: CustomStoryViewerAccess; storySlug: string; versionNumber?: number };

const QUERY_RETRY_DELAY_MS = 1500;
const MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING = 10;

/** Files are readable by the owner and by read-only viewers of the chat, never through a story share link. */
export type CustomStoryFileSource = Extract<CustomStoryDataSource, { kind: 'owner' | 'viewer' }>;

export function fileOptions(source: CustomStoryFileSource, path: string, versionNumber: number) {
	if (source.kind === 'viewer') {
		return trpc.customStoryViewer.getFile.queryOptions({
			access: source.access,
			storySlug: source.storySlug,
			path,
			versionNumber,
		});
	}
	const { chatId, storySlug } = ownerChatSource(source);
	return trpc.story.getCustomVersionFile.queryOptions({
		chatId,
		storySlug,
		path,
		versionNumber,
	});
}

export function queryDataOptions(dataSource: CustomStoryDataSource, queryId: string) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug, versionNumber } = dataSource;
		return trpc.customStoryViewer.getQueryData.queryOptions({ access, storySlug, queryId, versionNumber });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryQueryData.queryOptions({
			storyId: dataSource.storyId,
			queryId,
			versionNumber: dataSource.versionNumber,
		});
	}
	const { chatId, storySlug } = ownerChatSource(dataSource);
	return {
		...trpc.story.getCustomStoryQueryData.queryOptions({ chatId, storySlug, queryId }),
		retry: (failureCount: number) =>
			failureCount < MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING && chatActivityStore.getActivity(chatId).running,
		retryDelay: QUERY_RETRY_DELAY_MS,
	};
}

export function querySqlOptions(dataSource: CustomStoryDataSource, queryId: string) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug, versionNumber } = dataSource;
		return trpc.customStoryViewer.getQuerySql.queryOptions({ access, storySlug, queryId, versionNumber });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryQuerySql.queryOptions({
			storyId: dataSource.storyId,
			queryId,
			versionNumber: dataSource.versionNumber,
		});
	}
	const { chatId, storySlug } = ownerChatSource(dataSource);
	return trpc.story.getCustomStoryQuerySql.queryOptions({ chatId, storySlug, queryId });
}

export function narrativesOptions(dataSource: CustomStoryDataSource) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpc.customStoryViewer.getNarratives.queryOptions({ access, storySlug });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryNarratives.queryOptions({ storyId: dataSource.storyId });
	}
	const { chatId, storySlug } = ownerChatSource(dataSource);
	return trpc.story.getCustomStoryNarratives.queryOptions({ chatId, storySlug });
}

export function stateOptions(dataSource: CustomStoryDataSource) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpc.customStoryViewer.getState.queryOptions({ access, storySlug });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryState.queryOptions({ storyId: dataSource.storyId });
	}
	const { chatId, storySlug } = ownerChatSource(dataSource);
	return trpc.story.getCustomStoryState.queryOptions({ chatId, storySlug });
}

export async function saveStoryState(dataSource: CustomStoryDataSource, change: StoryStateChange): Promise<void> {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		await trpcClient.customStoryViewer.setState.mutate({ access, storySlug, change });
		return;
	}
	if (dataSource.kind === 'share') {
		await trpcClient.storyShare.setCustomStoryState.mutate({ storyId: dataSource.storyId, change });
		return;
	}
	const { chatId, storySlug } = ownerChatSource(dataSource);
	await trpcClient.story.setCustomStoryState.mutate({ chatId, storySlug, change });
}

function ownerChatSource(source: Extract<CustomStoryDataSource, { kind: 'owner' }>): {
	chatId: string;
	storySlug: string;
} {
	if (typeof source.chatId === 'string') {
		return { chatId: source.chatId, storySlug: source.storySlug };
	}
	throw new Error('This custom story is not attached to a chat.');
}
