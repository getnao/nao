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

export interface ChartPluginRenderContext {
	data: Record<string, unknown>[];
	config: ChartPluginConfig;
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
