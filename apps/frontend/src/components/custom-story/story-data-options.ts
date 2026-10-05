import type { CustomStoryViewerAccess } from '@nao/shared/story-app';
import { trpc } from '@/main';
import { chatActivityStore } from '@/stores/chat-activity';

/** Where a custom story's `useQueryData` calls are answered from: the owner's chat, a share link, or a read-only viewer. */
export type CustomStoryDataSource =
	| { kind: 'owner'; chatId: string; storySlug: string }
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
	return trpc.story.getCustomVersionFile.queryOptions({
		chatId: source.chatId,
		storySlug: source.storySlug,
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
	const { chatId, storySlug } = dataSource;
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
	const { chatId, storySlug } = dataSource;
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
	const { chatId, storySlug } = dataSource;
	return trpc.story.getCustomStoryNarratives.queryOptions({ chatId, storySlug });
}
