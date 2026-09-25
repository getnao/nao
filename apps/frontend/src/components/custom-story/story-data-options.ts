import { trpc } from '@/main';
import { chatActivityStore } from '@/stores/chat-activity';

/** Where a custom story's `useQueryData` calls are answered from: the owner's chat, or a share link. */
export type CustomStoryDataSource =
	| { kind: 'owner'; chatId: string; storySlug: string }
	| { kind: 'share'; shareId: string; versionNumber?: number };

const QUERY_RETRY_DELAY_MS = 1500;
const MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING = 10;

export function queryDataOptions(dataSource: CustomStoryDataSource, queryId: string) {
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryQueryData.queryOptions({
			shareId: dataSource.shareId,
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
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryQuerySql.queryOptions({
			shareId: dataSource.shareId,
			queryId,
			versionNumber: dataSource.versionNumber,
		});
	}
	const { chatId, storySlug } = dataSource;
	return trpc.story.getCustomStoryQuerySql.queryOptions({ chatId, storySlug, queryId });
}

export function narrativesOptions(dataSource: CustomStoryDataSource) {
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryNarratives.queryOptions({ shareId: dataSource.shareId });
	}
	const { chatId, storySlug } = dataSource;
	return trpc.story.getCustomStoryNarratives.queryOptions({ chatId, storySlug });
}
