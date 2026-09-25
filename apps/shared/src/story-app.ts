import type { ChartType } from './chart-types';
import type { displayChart } from './tools';
import type { StoryBlockReference } from './types';

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

/** Narrative id → text regenerated from the latest data */
export type StoryNarratives = Record<string, string>;

export interface StoryExportData {
	queries: Record<string, StoryQueryResult>;
	narratives: StoryNarratives;
}

/** File under `STORY_RUNTIME_PATH` holding every runtime module in one classic script, for downloaded stories. */
export const STORY_STANDALONE_RUNTIME_FILE = 'standalone.js';

/** Global the standalone runtime fills with each module namespace, keyed by bare specifier. */
export const STORY_STANDALONE_RUNTIME_GLOBAL = '__naoStoryRuntime';

/** Global the PDF renderer sets before a downloaded story boots. */
export const STORY_PRINT_FLAG = '__naoStoryPrint';

/** Set on `<html>` while a printed story lays out a deck: the PDF renderer then prints one slide per page. */
export const STORY_PRINT_SLIDES_ATTRIBUTE = 'data-nao-print-slides';

export const STORY_SLIDE_SIZE = { width: 1280, height: 720 } as const;

export const STORY_KIT_NARRATIVE_COMPONENT = 'Narrative';

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
	| { type: 'nao-story:narratives'; requestId: string }
	| { type: 'nao-story:error'; message: string; stack?: string }
	| { type: 'nao-story:copy-table'; columns: string[]; rows: Record<string, unknown>[] }
	| {
			type: 'nao-story:export-table';
			format: StoryTableExportFormat;
			filename: string;
			columns: string[];
			rows: Record<string, unknown>[];
	  }
	| ({ type: 'nao-story:edit-block' } & StoryBlockEditPayload)
	| { type: 'nao-story:query-sql'; requestId: string; queryId: string }
	| { type: 'nao-story:ask-block'; block: StoryBlockReference };

/** Host → frame. */
export type StoryHostMessage =
	| { type: 'nao-story:query-result'; requestId: string; result: StoryQueryResult }
	| { type: 'nao-story:query-error'; requestId: string; message: string }
	| { type: 'nao-story:query-sql-result'; requestId: string; sqlQuery: string }
	| { type: 'nao-story:query-sql-error'; requestId: string; message: string }
	| { type: 'nao-story:narratives-result'; requestId: string; narratives: StoryNarratives }
	| { type: 'nao-story:editing'; enabled: boolean };

export const isStoryFrameMessage = (value: unknown): value is StoryFrameMessage => {
	return (
		isStoryMessage(value) &&
		[
			'nao-story:ready',
			'nao-story:query',
			'nao-story:narratives',
			'nao-story:error',
			'nao-story:copy-table',
			'nao-story:export-table',
			'nao-story:edit-block',
			'nao-story:query-sql',
			'nao-story:ask-block',
		].includes(value.type)
	);
};

export const isStoryHostMessage = (value: unknown): value is StoryHostMessage => {
	return (
		isStoryMessage(value) &&
		[
			'nao-story:query-result',
			'nao-story:query-error',
			'nao-story:query-sql-result',
			'nao-story:query-sql-error',
			'nao-story:narratives-result',
			'nao-story:editing',
		].includes(value.type)
	);
};

const isStoryMessage = (value: unknown): value is { type: string } => {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
};
