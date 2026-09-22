import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import { MapAppView } from '@/components/mcp-app/map-app-view';
import { Spinner } from '@/components/ui/spinner';
import { NAO_MCP_EMBED_MEASURE_ATTR, useMcpAppEmbedHeightReporting } from '@/hooks/use-mcp-app-embed-height';
import { isLikelyMcpAppPayloadToken, readEmbedTokenFromLocation } from '@/lib/embed-token';
import { trpc } from '@/main';

export const Route = createFileRoute('/embed/map/$mapEmbedId')({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === 'string' ? search.token : '',
	}),
	component: MapEmbedPage,
});

function MapEmbedPage() {
	const { mapEmbedId } = Route.useParams();
	const searchStr = useRouterState({ select: (s) => s.location.searchStr });
	const token = useMemo(() => readEmbedTokenFromLocation(searchStr), [searchStr]);
	const usedWrongTokenFormat = token.length > 0 && isLikelyMcpAppPayloadToken(token);

	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.add('nao-embed-app');
		return () => {
			root.classList.remove('nao-embed-app');
		};
	}, []);

	useMcpAppEmbedHeightReporting();

	const mapQuery = useQuery(trpc.embed.getMap.queryOptions({ mapEmbedId, token }));
	const map = mapQuery.data;

	let inner: ReactNode;
	if (mapQuery.isLoading) {
		inner = (
			<div className='flex min-h-[14rem] items-center justify-center py-10'>
				<Spinner />
			</div>
		);
	} else if (mapQuery.isError || !map) {
		inner = (
			<div className='flex min-h-[10rem] flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground'>
				<p>Map unavailable or link expired.</p>
				{usedWrongTokenFormat ? (
					<p className='max-w-md text-xs'>
						Open the full <span className='font-medium'>embedUrl</span> link from{' '}
						<code className='text-foreground'>display_map</code> (or the &quot;Interactive app&quot;
						markdown link), not the JSON tool payload.
					</p>
				) : null}
			</div>
		);
	} else {
		const naoUrl =
			typeof map.sourceChatId === 'string' && map.sourceChatId.trim()
				? `${window.location.origin}/${map.sourceChatId.trim()}`
				: undefined;
		inner = (
			<MapAppView
				config={map.mapConfig}
				data={map.data}
				columns={map.columns}
				naoUrl={naoUrl}
				projectId={map.projectId}
				customBoundaries={map.customBoundaries}
			/>
		);
	}

	return (
		<div {...{ [NAO_MCP_EMBED_MEASURE_ATTR]: '' }} className='flex min-h-0 min-w-0 flex-1 flex-col bg-background'>
			{inner}
		</div>
	);
}
