import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { ChartAppView } from '@/components/mcp-app/chart-app-view';
import { Spinner } from '@/components/ui/spinner';
import { NAO_MCP_EMBED_MEASURE_ATTR, useMcpAppEmbedHeightReporting } from '@/hooks/use-mcp-app-embed-height';
import { isLikelyMcpAppPayloadToken, readEmbedTokenFromLocation } from '@/lib/embed-token';
import { trpc } from '@/main';

export const Route = createFileRoute('/embed/chart/$chartEmbedId')({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === 'string' ? search.token : '',
	}),
	component: ChartEmbedPage,
});

function ChartEmbedPage() {
	const { chartEmbedId } = Route.useParams();
	const searchStr = useRouterState({ select: (s) => s.location.searchStr });
	const token = useMemo(() => readEmbedTokenFromLocation(searchStr), [searchStr]);
	const usedWrongTokenFormat = token.length > 0 && isLikelyMcpAppPayloadToken(token);

	useMcpAppEmbedHeightReporting();

	const chartQuery = useQuery(trpc.embed.getChart.queryOptions({ chartEmbedId, token }));
	const chart = chartQuery.data;

	let inner: ReactNode;
	if (chartQuery.isLoading) {
		inner = (
			<div className='flex min-h-[14rem] items-center justify-center py-10'>
				<Spinner />
			</div>
		);
	} else if (chartQuery.isError || !chart) {
		inner = (
			<div className='flex min-h-[10rem] flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground'>
				<p>Chart unavailable or link expired.</p>
				{usedWrongTokenFormat ? (
					<p className='max-w-md text-xs'>
						Open the full <span className='font-medium'>embedUrl</span> link from{' '}
						<code className='text-foreground'>display_chart</code> (or the &quot;Interactive app&quot;
						markdown link), not the JSON tool payload.
					</p>
				) : null}
			</div>
		);
	} else {
		const naoUrl =
			typeof chart.sourceChatId === 'string' && chart.sourceChatId.trim()
				? `${window.location.origin}/${chart.sourceChatId.trim()}`
				: undefined;
		inner = <ChartAppView config={chart.chartConfig} data={chart.data} naoUrl={naoUrl} />;
	}

	return (
		<div {...{ [NAO_MCP_EMBED_MEASURE_ATTR]: '' }} className='flex min-h-0 min-w-0 flex-1 flex-col bg-background'>
			{inner}
		</div>
	);
}
