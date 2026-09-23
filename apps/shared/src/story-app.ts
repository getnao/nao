import type { ChartType } from './chart-types';
import type { displayChart } from './tools';

/** Bare specifiers a story may import. Everything else is rejected at build time. */
export const STORY_APP_ALLOWED_IMPORTS = [
	'react',
	'react/jsx-runtime',
	'react-dom',
	'react-dom/client',
	'recharts',
	'lucide-react',
	'@nao/story-kit',
] as const;

export type StoryAppAllowedImport = (typeof STORY_APP_ALLOWED_IMPORTS)[number];

export const STORY_APP_MANIFEST_PATH = 'nao.json';

export const STORY_APP_ENTRY_CANDIDATES = ['app.jsx', 'app.tsx', 'app.js', 'app.ts'] as const;

export const MAX_STORY_BUNDLE_BYTES = 2 * 1024 * 1024;

export const isAllowedStoryImport = (specifier: string): specifier is StoryAppAllowedImport => {
	return (STORY_APP_ALLOWED_IMPORTS as readonly string[]).includes(specifier);
};

/** Module the frame's bootstrap uses to mount the app and talk to the host; stories cannot import it. */
export const STORY_HOST_MODULE = '@nao/story-host';

export const STORY_RUNTIME_PATH = '/story-runtime';

/** Bare specifier → file name (without extension) under `STORY_RUNTIME_PATH`. Every import map entry comes from here. */
export const STORY_RUNTIME_MODULES: Record<StoryAppAllowedImport | typeof STORY_HOST_MODULE, string> = {
	react: 'react',
	'react/jsx-runtime': 'react-jsx-runtime',
	'react-dom': 'react-dom',
	'react-dom/client': 'react-dom-client',
	recharts: 'recharts',
	'lucide-react': 'lucide-react',
	'@nao/story-kit': 'story-kit',
	[STORY_HOST_MODULE]: 'story-host',
};

export interface StoryQueryResult {
	columns: string[];
	data: unknown[];
}

export type StoryTableExportFormat = 'csv' | 'xlsx';

export const STORY_KIT_EDITABLE_BLOCKS = ['BarChart', 'LineChart', 'Chart', 'KpiCard'] as const;

export type StoryKitEditableBlock = (typeof STORY_KIT_EDITABLE_BLOCKS)[number];

export interface StoryKitBlockRef {
	component: StoryKitEditableBlock;
	props: Record<string, unknown>;
}

export type StoryBlockChartConfig = Omit<displayChart.KpiCardInput, 'chart_type'> & {
	chart_type: ChartType;
};

export interface StoryBlockEditRequest {
	block: StoryKitBlockRef;
	config: StoryBlockChartConfig;
	columns: string[];
	rows: Record<string, unknown>[];
}

export interface StoryBlockColors {
	palette: string[];
	resolved: Record<string, string>;
}

export interface StoryBlockEditPayload extends StoryBlockEditRequest {
	colors: StoryBlockColors;
}

export interface StoryKitBlockChange {
	component?: StoryKitEditableBlock;
	set: Record<string, unknown>;
	unset: string[];
}

export const isStoryKitEditableBlock = (value: string): value is StoryKitEditableBlock => {
	return (STORY_KIT_EDITABLE_BLOCKS as readonly string[]).includes(value);
};

/** Frame → host. */
export type StoryFrameMessage =
	| { type: 'nao-story:ready' }
	| { type: 'nao-story:query'; requestId: string; queryId: string }
	| { type: 'nao-story:error'; message: string; stack?: string }
	| { type: 'nao-story:copy-table'; columns: string[]; rows: Record<string, unknown>[] }
	| {
			type: 'nao-story:export-table';
			format: StoryTableExportFormat;
			filename: string;
			columns: string[];
			rows: Record<string, unknown>[];
	  }
	| ({ type: 'nao-story:edit-block' } & StoryBlockEditPayload);

/** Host → frame. */
export type StoryHostMessage =
	| { type: 'nao-story:query-result'; requestId: string; result: StoryQueryResult }
	| { type: 'nao-story:query-error'; requestId: string; message: string }
	| { type: 'nao-story:editing'; enabled: boolean };

export const isStoryFrameMessage = (value: unknown): value is StoryFrameMessage => {
	return (
		isStoryMessage(value) &&
		[
			'nao-story:ready',
			'nao-story:query',
			'nao-story:error',
			'nao-story:copy-table',
			'nao-story:export-table',
			'nao-story:edit-block',
		].includes(value.type)
	);
};

export const isStoryHostMessage = (value: unknown): value is StoryHostMessage => {
	return (
		isStoryMessage(value) &&
		['nao-story:query-result', 'nao-story:query-error', 'nao-story:editing'].includes(value.type)
	);
};

const isStoryMessage = (value: unknown): value is { type: string } => {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
};
