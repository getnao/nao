import type { QueryClient } from '@tanstack/react-query';
import type {
	CustomStoryViewerAccess,
	StoryMapBoundary,
	StoryQueryResult,
	StorySqlRequest,
	StoryStateChange,
} from '@nao/shared/story-app';
import type { StoryModelRequest, StoryModelResult } from '@nao/shared/story-models';
import type { StoryQueryInputs } from '@nao/shared/story-query-inputs';
import { trpc, trpcClient } from '@/main';
import { chatActivityStore } from '@/stores/chat-activity';

/**
 * Where a custom story's `useQueryData` calls are answered from: the owner's chat, a share link, a read-only viewer,
 * or the rows saved with a standalone story.
 */
export type CustomStoryDataSource =
	| { kind: 'owner'; chatId: string; storySlug: string; versionNumber?: number }
	| { kind: 'share'; storyId: string; versionNumber?: number }
	| { kind: 'viewer'; access: CustomStoryViewerAccess; storySlug: string; versionNumber?: number }
	| { kind: 'standalone'; storyId: string; storySlug: string; versionNumber?: number };

const QUERY_RETRY_DELAY_MS = 1500;
const MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING = 10;

/** Files are readable by the owner and by read-only viewers of the chat, never through a story share link. */
export type CustomStoryFileSource = Extract<CustomStoryDataSource, { kind: 'owner' | 'viewer' | 'standalone' }>;

export function fileOptions(source: CustomStoryFileSource, path: string, versionNumber: number) {
	if (source.kind === 'viewer') {
		return trpc.customStoryViewer.getFile.queryOptions({
			access: source.access,
			storySlug: source.storySlug,
			path,
			versionNumber,
		});
	}
	if (source.kind === 'standalone') {
		return trpc.standaloneCustomStory.getFile.queryOptions({ storyId: source.storyId, path, versionNumber });
	}
	return trpc.story.getCustomVersionFile.queryOptions({
		chatId: source.chatId,
		storySlug: source.storySlug,
		path,
		versionNumber,
	});
}

export function queryDataOptions(dataSource: CustomStoryDataSource, queryId: string, inputs?: StoryQueryInputs) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug, versionNumber } = dataSource;
		return trpc.customStoryViewer.getQueryData.queryOptions({ access, storySlug, queryId, versionNumber, inputs });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryQueryData.queryOptions({
			storyId: dataSource.storyId,
			queryId,
			versionNumber: dataSource.versionNumber,
			inputs,
		});
	}
	if (dataSource.kind === 'standalone') {
		const { storyId, versionNumber } = dataSource;
		return trpc.standaloneCustomStory.getQueryData.queryOptions({ storyId, queryId, versionNumber, inputs });
	}
	const { chatId, storySlug, versionNumber } = dataSource;
	return {
		...trpc.story.getCustomStoryQueryData.queryOptions({ chatId, storySlug, queryId, versionNumber, inputs }),
		retry: (failureCount: number) =>
			failureCount < MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING && chatActivityStore.getActivity(chatId).running,
		retryDelay: QUERY_RETRY_DELAY_MS,
	};
}

/** The models the person viewing the story can call, from the story's project. */
export function modelsOptions(dataSource: CustomStoryDataSource) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpc.customStoryViewer.listModels.queryOptions({ access, storySlug });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.listCustomStoryModels.queryOptions({ storyId: dataSource.storyId });
	}
	if (dataSource.kind === 'standalone') {
		return trpc.standaloneCustomStory.listModels.queryOptions({ storyId: dataSource.storyId });
	}
	const { chatId, storySlug } = dataSource;
	return trpc.story.listCustomStoryModels.queryOptions({ chatId, storySlug });
}

/** A model call runs as the person viewing the story and is billed to them. */
export function runStoryModel(
	dataSource: CustomStoryDataSource,
	request: StoryModelRequest,
): Promise<StoryModelResult> {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpcClient.customStoryViewer.runModel.mutate({ access, storySlug, request });
	}
	if (dataSource.kind === 'share') {
		return trpcClient.storyShare.runCustomStoryModel.mutate({ storyId: dataSource.storyId, request });
	}
	if (dataSource.kind === 'standalone') {
		return trpcClient.standaloneCustomStory.runModel.mutate({ storyId: dataSource.storyId, request });
	}
	const { chatId, storySlug } = dataSource;
	return trpcClient.story.runCustomStoryModel.mutate({ chatId, storySlug, request });
}

/** SQL the story writes itself runs as the person viewing it, wherever the story is opened from. */
export function runStorySql(dataSource: CustomStoryDataSource, request: StorySqlRequest): Promise<StoryQueryResult> {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpcClient.customStoryViewer.runSql.mutate({ access, storySlug, request });
	}
	if (dataSource.kind === 'share') {
		return trpcClient.storyShare.runCustomStorySql.mutate({ storyId: dataSource.storyId, request });
	}
	if (dataSource.kind === 'standalone') {
		return Promise.reject(new Error('Only stories built in a chat can run their own SQL.'));
	}
	const { chatId, storySlug } = dataSource;
	return trpcClient.story.runCustomStorySql.mutate({ chatId, storySlug, request });
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
	if (dataSource.kind === 'standalone') {
		return trpc.standaloneCustomStory.getQuerySql.queryOptions({ storyId: dataSource.storyId, queryId });
	}
	const { chatId, storySlug, versionNumber } = dataSource;
	return trpc.story.getCustomStoryQuerySql.queryOptions({ chatId, storySlug, queryId, versionNumber });
}

/** Chart plugins come from the story's own project `agent/charts` folder, whichever project the viewer has selected. */
export async function fetchChartPluginSource(
	queryClient: QueryClient,
	dataSource: CustomStoryDataSource,
	chartType: string,
): Promise<string> {
	const sources = await fetchChartPluginSources(queryClient, dataSource);
	const source = sources[chartType];
	if (source === undefined) {
		throw new Error(`Custom chart "${chartType}" is not available.`);
	}
	return source;
}

/** Every chart plugin's source by type, so a downloaded story draws its `<Chart type>` blocks offline. */
export function fetchChartPluginSources(
	queryClient: QueryClient,
	dataSource: CustomStoryDataSource,
): Promise<Record<string, string>> {
	return queryClient.fetchQuery({ ...chartPluginsOptions(dataSource), staleTime: 0 });
}

function chartPluginsOptions(dataSource: CustomStoryDataSource) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpc.customStoryViewer.getChartPlugins.queryOptions({ access, storySlug });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryChartPlugins.queryOptions({ storyId: dataSource.storyId });
	}
	if (dataSource.kind === 'standalone') {
		return trpc.standaloneCustomStory.getChartPlugins.queryOptions({ storyId: dataSource.storyId });
	}
	const { chatId, storySlug } = dataSource;
	return trpc.story.getCustomStoryChartPlugins.queryOptions({ chatId, storySlug });
}

/** Boundary sets come from the story's own project, like its chart plugins. */
export async function fetchMapBoundary(
	queryClient: QueryClient,
	dataSource: CustomStoryDataSource,
	key: string,
): Promise<StoryMapBoundary> {
	const boundary = await queryClient.fetchQuery({ ...mapBoundaryOptions(dataSource, key), staleTime: 0 });
	if (!boundary) {
		throw new Error(`Map boundary "${key}" is not available.`);
	}
	return boundary;
}

function mapBoundaryOptions(dataSource: CustomStoryDataSource, key: string) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpc.customStoryViewer.getMapBoundary.queryOptions({ access, storySlug, key });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryMapBoundary.queryOptions({ storyId: dataSource.storyId, key });
	}
	if (dataSource.kind === 'standalone') {
		return trpc.standaloneCustomStory.getMapBoundary.queryOptions({ storyId: dataSource.storyId, key });
	}
	const { chatId, storySlug } = dataSource;
	return trpc.story.getCustomStoryMapBoundary.queryOptions({ chatId, storySlug, key });
}

export function narrativesOptions(dataSource: CustomStoryDataSource) {
	if (dataSource.kind === 'viewer') {
		const { access, storySlug } = dataSource;
		return trpc.customStoryViewer.getNarratives.queryOptions({ access, storySlug });
	}
	if (dataSource.kind === 'share') {
		return trpc.storyShare.getCustomStoryNarratives.queryOptions({ storyId: dataSource.storyId });
	}
	if (dataSource.kind === 'standalone') {
		return trpc.standaloneCustomStory.getNarratives.queryOptions({ storyId: dataSource.storyId });
	}
	const { chatId, storySlug } = dataSource;
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
	if (dataSource.kind === 'standalone') {
		return trpc.standaloneCustomStory.getState.queryOptions({ storyId: dataSource.storyId });
	}
	const { chatId, storySlug } = dataSource;
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
	if (dataSource.kind === 'standalone') {
		await trpcClient.standaloneCustomStory.setState.mutate({ storyId: dataSource.storyId, change });
		return;
	}
	const { chatId, storySlug } = dataSource;
	await trpcClient.story.setCustomStoryState.mutate({ chatId, storySlug, change });
}
