import type { SeriesConfig, XAxisType } from './tools/display-chart';

export interface ChartPluginManifestEntry {
	type: string;
	name: string;
	description: string;
	version: string;
}

export interface ChartPluginConfig {
	chartType: string;
	xAxisKey: string;
	xAxisType: XAxisType | null;
	series: SeriesConfig[];
	title?: string;
}

/** `edit` while a viewer who can change the story has it open; `print` in PDF exports and deliveries. */
export type ChartPluginMode = 'view' | 'edit' | 'print';

export interface ChartPluginRenderContext {
	data: Record<string, unknown>[];
	config: ChartPluginConfig;
	/** The `settings` prop of the chart's block in the story, as the plugin last saved it. */
	settings: unknown;
	mode: ChartPluginMode;
	/** Only in `edit` mode: writes `settings` into the block, which publishes a new story version. */
	saveSettings?: (settings: unknown) => Promise<void>;
	libs: {
		React: unknown;
		ReactDOM: unknown;
		Recharts: unknown;
	};
	theme: 'light' | 'dark';
	colors: string[];
}

export type ChartPluginCleanup = void | (() => void);

export interface ChartPluginModule {
	render: (
		element: HTMLElement,
		context: ChartPluginRenderContext,
	) => ChartPluginCleanup | Promise<ChartPluginCleanup>;
}
