import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DownloadFormat } from '@nao/shared/types';
import type { QueryDataMap } from '@/components/story-embeds';

import { StoryAppView } from '@/components/mcp-app/story-app-view';
import { Spinner } from '@/components/ui/spinner';
import { NAO_MCP_EMBED_MEASURE_ATTR, useMcpAppEmbedHeightReporting } from '@/hooks/use-mcp-app-embed-height';
import { readEmbedTokenFromLocation } from '@/lib/embed-token';
import { trpc, trpcClient } from '@/main';

export const Route = createFileRoute('/embed/story/$storyId')({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === 'string' ? search.token : '',
	}),
	component: StoryEmbedPage,
});

function StoryEmbedPage() {
	const { storyId } = Route.useParams();
	const searchStr = useRouterState({ select: (s) => s.location.searchStr });
	const token = useMemo(() => readEmbedTokenFromLocation(searchStr), [searchStr]);

	useMcpAppEmbedHeightReporting();

	const storyQuery = useQuery(trpc.embed.getStory.queryOptions({ storyId, token }));
	const story = storyQuery.data;

	let inner: ReactNode;
	if (storyQuery.isLoading) {
		inner = (
			<div className='flex min-h-[14rem] items-center justify-center py-10'>
				<Spinner />
			</div>
		);
	} else if (storyQuery.isError || !story) {
		inner = (
			<div className='flex min-h-[10rem] items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground'>
				Story unavailable or link expired.
			</div>
		);
	} else {
		const naoUrl = `${window.location.origin}${story.openInNaoPath}`;
		inner = (
			<StoryAppView
				title={story.title}
				code={story.code}
				queryData={story.queryData as QueryDataMap | null}
				naoUrl={naoUrl}
				onDownload={(format) => downloadStory(storyId, token, format)}
			/>
		);
	}

	return (
		<div {...{ [NAO_MCP_EMBED_MEASURE_ATTR]: '' }} className='flex min-h-0 min-w-0 flex-1 flex-col bg-panel'>
			{inner}
		</div>
	);
}

async function downloadStory(storyId: string, token: string, format: DownloadFormat): Promise<void> {
	const result = await trpcClient.embed.downloadStory.mutate({ storyId, token, format });
	const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
	const blob = new Blob([bytes], { type: result.mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = result.filename;
	a.click();
	URL.revokeObjectURL(url);
}
