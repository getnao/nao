import {
	buildMcpEmbedMarkdownLinks,
	chartAppPayloadFrom,
	mapAppPayloadFrom,
	type McpChartAppPayload,
	type McpMapAppPayload,
	storyAppPayloadFrom,
} from '@nao/shared';
import type { McpEmbedKind } from '@nao/shared/types';
import { z } from 'zod';

import type { ToolResult } from '../logging';
import { chatUrl } from '../urls';
import { attachSandboxToAppPayload } from './embed-payload';

export type StoryMcpToolPayload = Record<string, unknown> & { embedUrl: string };

export type ChartToolPayload = McpChartAppPayload & Record<string, unknown>;

export type MapToolPayload = McpMapAppPayload & Record<string, unknown>;

export type CustomStorySourceFile = { path: string; content: string };

export type CustomStoryMcpToolPayload = {
	id: string;
	title: string;
	url: string;
	chatUrl: string | null;
	version?: number;
	buildErrors?: string[];
	sourceFiles?: CustomStorySourceFile[];
};

const CUSTOM_STORY_FIELDS = {
	version: z.number().optional().describe('Custom stories only: latest published version, 0 while still a draft.'),
	buildErrors: z
		.array(z.string())
		.optional()
		.describe('Custom stories only: why the draft does not build. Nothing was published.'),
	sourceFiles: z
		.array(z.object({ path: z.string(), content: z.string() }))
		.optional()
		.describe('Custom stories only: the draft source files, to edit and send back to `update_story`.'),
};

export const CUSTOM_STORY_OUTPUT_SCHEMA = {
	id: z.string().describe('Story UUID.'),
	title: z.string().describe('Story title.'),
	url: z.url().describe('URL to open the story in nao — share it with the user.'),
	chatUrl: z.url().nullable().describe('Chat the story was built from.'),
	format: z.literal('custom'),
	...CUSTOM_STORY_FIELDS,
};

export const STORY_OUTPUT_SCHEMA = {
	id: z.string().describe('Story UUID.'),
	title: z.string().describe('Story title.'),
	url: z.url().describe('URL to open the story in the nao UI.'),
	chatUrl: z.url().nullable().describe('Source chat URL, or null for standalone stories.'),
	format: z
		.literal('custom')
		.optional()
		.describe('Set for a custom story: an interactive app that only renders in nao, so share `url` with the user.'),
	...CUSTOM_STORY_FIELDS,
	embedUrl: z
		.url()
		.optional()
		.describe('Sandboxed embed URL — render this in an iframe to show the story. Absent for custom stories.'),
	sandboxStoryHtml: z
		.string()
		.optional()
		.describe('Self-contained HTML for inline rendering when small enough; omitted for large stories.'),
};

export function buildStoryToolResult(
	output: StoryMcpToolPayload,
	options?: { sandboxStoryHtml?: string | null },
): ToolResult {
	const title = typeof output.title === 'string' ? output.title : 'Story';
	const naoUrl = typeof output.url === 'string' ? output.url : null;
	const slimPayload = storyAppPayloadFrom({
		embedUrl: output.embedUrl,
		id: output.id,
		title: output.title,
		url: output.url,
		chatUrl: output.chatUrl,
	});

	return buildEmbedToolResult({
		kind: 'story',
		title,
		embedUrl: output.embedUrl,
		naoUrl,
		jsonPayload: output,
		structuredBase: slimPayload,
		sandboxHtml: options?.sandboxStoryHtml,
	});
}

/** A custom story is a React app that only renders inside nao, so its result carries the link instead of an embed. */
export function buildCustomStoryToolResult(output: CustomStoryMcpToolPayload): ToolResult {
	const structuredContent = { ...output, format: 'custom' as const };
	return {
		content: [
			{ type: 'text', text: JSON.stringify(structuredContent) },
			{ type: 'text', text: describeCustomStoryResult(output) },
		],
		structuredContent,
	};
}

function describeCustomStoryResult(output: CustomStoryMcpToolPayload): string {
	if (output.buildErrors?.length) {
		const errors = output.buildErrors.map((error) => `- ${error}`).join('\n');
		return `**${output.title}** does not build, so nothing was published:\n${errors}\n\nFix the files and call \`update_story\` with story_id "${output.id}".`;
	}
	if (output.version === 0) {
		return `**${output.title}** is a draft and is not published yet. Edit its \`sourceFiles\`, then send them to \`update_story\` with story_id "${output.id}" to publish it.`;
	}
	return `**${output.title}**\n\n[Open in nao](${output.url})`;
}

export function buildChartToolResult(
	output: ChartToolPayload,
	options: { sandboxChartHtml?: string | null },
): ToolResult {
	const title = typeof output.title === 'string' ? output.title : 'Chart';
	const embedUrl = typeof output.embedUrl === 'string' && output.embedUrl.length > 0 ? output.embedUrl : null;
	const chatId = typeof output.chatId === 'string' ? output.chatId : null;
	const naoUrl = chatId ? chatUrl(chatId) : null;
	const slimPayload = chartAppPayloadFrom(output);

	return buildEmbedToolResult({
		kind: 'chart',
		title,
		embedUrl,
		naoUrl,
		jsonPayload: slimPayload,
		structuredBase: slimPayload,
		sandboxHtml: options.sandboxChartHtml,
		missingQueryMessage:
			embedUrl === null
				? `_Query data for \`${output.queryId}\` not found — re-run \`execute_sql\` then \`display_chart\`. The JSON payload includes the \`<chart>\` block._`
				: undefined,
	});
}

export function buildMapToolResult(output: MapToolPayload, options: { sandboxMapHtml?: string | null }): ToolResult {
	const title = typeof output.title === 'string' ? output.title : 'Map';
	const embedUrl = typeof output.embedUrl === 'string' && output.embedUrl.length > 0 ? output.embedUrl : null;
	const chatId = typeof output.chatId === 'string' ? output.chatId : null;
	const naoUrl = chatId ? chatUrl(chatId) : null;
	const slimPayload = mapAppPayloadFrom(output);

	return buildEmbedToolResult({
		kind: 'map',
		title,
		embedUrl,
		naoUrl,
		jsonPayload: slimPayload,
		structuredBase: slimPayload,
		sandboxHtml: options.sandboxMapHtml,
		missingQueryMessage:
			embedUrl === null
				? `_Query data for \`${output.queryId}\` not found — re-run \`execute_sql\` then \`display_map\`. The JSON payload includes the \`<map>\` block._`
				: undefined,
	});
}

function buildEmbedToolResult(options: {
	kind: McpEmbedKind;
	title: string;
	embedUrl: string | null;
	naoUrl: string | null;
	jsonPayload: Record<string, unknown>;
	structuredBase: Record<string, unknown>;
	sandboxHtml?: string | null;
	missingQueryMessage?: string;
}): ToolResult {
	const fallbackText = buildMcpEmbedMarkdownLinks({
		title: options.title,
		embedUrl: options.embedUrl,
		naoUrl: options.naoUrl,
		missingQueryMessage: options.missingQueryMessage,
	});

	const structuredContent = attachSandboxToAppPayload(options.structuredBase, options.sandboxHtml, options.kind);

	return {
		content: [
			{ type: 'text', text: JSON.stringify(options.jsonPayload) },
			{ type: 'text', text: fallbackText },
		],
		structuredContent,
	};
}
