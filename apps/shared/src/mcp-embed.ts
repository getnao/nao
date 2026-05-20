import type * as displayChart from './tools/display-chart';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const MCP_EMBED_TOKEN_TTL_MS = WEEK_MS;
export const MCP_QUERY_DATA_RETENTION_MS = WEEK_MS;

export type McpChartEmbedStoredConfig = {
	chartType: displayChart.Input['chart_type'];
	xAxisKey: displayChart.Input['x_axis_key'];
	xAxisType: displayChart.Input['x_axis_type'];
	series: displayChart.Input['series'];
	title: string;
};

export type McpChartAppPayload = {
	embedUrl: string | null;
	chartEmbedId: string | null;
	block: string;
	queryId: string;
	title: string;
	chatId: string | null;
};

export type McpStoryAppPayload = {
	embedUrl: string;
	id: string;
	title: string;
	url: string;
	chatUrl: string | null;
};

export function storyAppPayloadFrom(output: {
	embedUrl: string;
	id: unknown;
	title: unknown;
	url: unknown;
	chatUrl?: unknown;
}): McpStoryAppPayload {
	return {
		embedUrl: output.embedUrl,
		id: String(output.id),
		title: typeof output.title === 'string' ? output.title : 'Story',
		url: typeof output.url === 'string' ? output.url : '',
		chatUrl: typeof output.chatUrl === 'string' ? output.chatUrl : null,
	};
}

export function chartAppPayloadFrom(output: Record<string, unknown> & McpChartAppPayload): McpChartAppPayload {
	return {
		embedUrl: output.embedUrl,
		chartEmbedId: output.chartEmbedId,
		block: output.block,
		queryId: output.queryId,
		title: output.title,
		chatId: output.chatId,
	};
}

export function buildMcpEmbedMarkdownLinks(options: {
	title: string;
	embedUrl?: string | null;
	naoUrl?: string | null;
	missingQueryMessage?: string;
}): string {
	const { title, embedUrl, naoUrl, missingQueryMessage } = options;
	if (missingQueryMessage) {
		return `**${title}**\n\n${missingQueryMessage}`;
	}
	if (embedUrl) {
		if (naoUrl) {
			return `**${title}**\n\n[Open in nao](${naoUrl}) · [Interactive app](${embedUrl})`;
		}
		return `**${title}**\n\n[Interactive app](${embedUrl})`;
	}
	return `**${title}**`;
}
