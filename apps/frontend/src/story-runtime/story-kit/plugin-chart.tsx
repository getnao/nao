import { storyThemeMode } from '@nao/shared/story-theme';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Recharts from 'recharts';

import { beginChartDrawing, isPrintMode, requestChartPlugin, requestChartSettingsSave } from '../story-host';
import { resolveSeriesPalette } from '../story-colors';
import { Block, BlockState } from './block';
import { resolveChart, toSeriesConfigs } from './block-config';
import { useStoryEditing, useStoryTheme } from './hooks';
import { useBlockData } from './use-block-data';
import type {
	ChartPluginCleanup,
	ChartPluginMode,
	ChartPluginModule,
	ChartPluginRenderContext,
} from '@nao/shared/chart-plugin';
import type { StoryChartSettingsSave } from '@nao/shared/story-app';
import type { ChartProps } from './chart-shared';
import type { Row } from './use-block-data';

interface PluginChartBlockProps extends ChartProps {
	kind: string;
	chartType: string;
	blockRef: StoryChartSettingsSave['block'];
	settings?: unknown;
}

type PluginState =
	| { status: 'loading'; module: null; error: null }
	| { status: 'ready'; module: ChartPluginModule; error: null }
	| { status: 'error'; module: null; error: string };

const DEFAULT_CHART_HEIGHT = 260;
const LOADING_PLUGIN: PluginState = { status: 'loading', module: null, error: null };
const pluginModules = new Map<string, Promise<ChartPluginModule>>();

/** A chart drawn by one of the project's `agent/charts` plugins, the same way the chat renders it. */
export function PluginChartBlock({
	kind,
	chartType,
	blockRef,
	settings,
	queryId,
	data,
	sql,
	databaseId,
	filters,
	params,
	height = DEFAULT_CHART_HEIGHT,
	title,
	description,
	className,
	style,
	...options
}: PluginChartBlockProps) {
	const source = useBlockData({ queryId, data, sql, databaseId, filters, params });
	const resolved = source.status === 'ready' ? resolveChart(source.rows, source.columns, options) : null;
	const [isDrawing, setIsDrawing] = React.useState(true);
	const hasRows = source.status === 'ready' && source.rows.length > 0;
	useChartDrawingSignal(source.status === 'loading' || (hasRows && isDrawing));

	return (
		<Block
			kind={kind}
			queryId={queryId}
			title={title}
			description={description}
			className={className}
			style={style}
		>
			<BlockState data={source}>
				{(rows) =>
					resolved && (
						<PluginChartBody
							chartType={chartType}
							height={height}
							rows={rows}
							blockRef={blockRef}
							settings={settings}
							onDrawingChange={setIsDrawing}
							config={{
								chartType,
								xAxisKey: resolved.xAxisKey,
								xAxisType: options.xAxisType ?? null,
								series: toSeriesConfigs(resolved.series, options),
								title,
							}}
						/>
					)
				}
			</BlockState>
		</Block>
	);
}

interface PluginChartBodyProps {
	chartType: string;
	height: number;
	rows: Row[];
	config: ChartPluginRenderContext['config'];
	blockRef: StoryChartSettingsSave['block'];
	settings: unknown;
	onDrawingChange: (isDrawing: boolean) => void;
}

function PluginChartBody({
	chartType,
	height,
	rows,
	config,
	blockRef,
	settings,
	onDrawingChange,
}: PluginChartBodyProps) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const plugin = useChartPlugin(chartType);
	const theme = useStoryTheme();
	const mode = useChartPluginMode();
	const [renderError, setRenderError] = React.useState<string | null>(null);
	const configKey = JSON.stringify(config);
	const blockKey = JSON.stringify(blockRef);
	const settingsKey = JSON.stringify(settings ?? null);

	const context = React.useMemo<ChartPluginRenderContext>(
		() => ({
			data: rows,
			config: JSON.parse(configKey) as ChartPluginRenderContext['config'],
			settings: JSON.parse(settingsKey) as unknown,
			mode,
			saveSettings: mode === 'edit' ? saveSettingsOf(JSON.parse(blockKey)) : undefined,
			libs: { React, ReactDOM, Recharts },
			theme: theme ? storyThemeMode(theme) : 'light',
			colors: resolveSeriesPalette(),
		}),
		[rows, configKey, settingsKey, blockKey, mode, theme],
	);

	React.useEffect(() => {
		if (plugin.error) {
			onDrawingChange(false);
		}
	}, [plugin.error, onDrawingChange]);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container || !plugin.module) {
			return;
		}
		const element = appendDrawTarget(container);
		let disposed = false;
		let cleanup: ChartPluginCleanup;
		setRenderError(null);
		onDrawingChange(true);
		const { render } = plugin.module;
		Promise.resolve()
			.then(() => render(element, context))
			.then((nextCleanup) => {
				if (disposed) {
					nextCleanup?.();
				} else {
					cleanup = nextCleanup;
				}
			})
			.catch((error: unknown) => {
				if (!disposed) {
					setRenderError(describeError(error));
				}
			})
			.finally(() => {
				if (!disposed) {
					onDrawingChange(false);
				}
			});
		return () => {
			disposed = true;
			cleanup?.();
			element.remove();
		};
	}, [plugin.module, context, onDrawingChange]);

	if (plugin.error) {
		return <PluginChartError error={plugin.error} />;
	}
	if (plugin.status === 'loading') {
		return <div className='nao-skeleton' aria-busy='true' />;
	}
	return (
		<>
			{renderError && <PluginChartError error={renderError} />}
			<div ref={containerRef} className='nao-chart' style={{ height }} hidden={renderError !== null} />
		</>
	);
}

/** Each draw gets its own element, so a slow draw that is no longer current cannot write into the next one. */
function appendDrawTarget(container: HTMLElement): HTMLDivElement {
	const element = document.createElement('div');
	element.style.width = '100%';
	element.style.height = '100%';
	container.appendChild(element);
	return element;
}

function PluginChartError({ error }: { error: string }) {
	return (
		<div className='nao-block__state nao-block__state--error' role='alert'>
			Could not render custom chart: {error}
		</div>
	);
}

/** While `isDrawing`, the chart counts as still drawing for the PDF renderer. */
function useChartDrawingSignal(isDrawing: boolean): void {
	React.useEffect(() => {
		if (isDrawing) {
			return beginChartDrawing();
		}
	}, [isDrawing]);
}

function useChartPluginMode(): ChartPluginMode {
	const editingEnabled = useStoryEditing();
	if (isPrintMode()) {
		return 'print';
	}
	return editingEnabled ? 'edit' : 'view';
}

function saveSettingsOf(block: StoryChartSettingsSave['block']): (settings: unknown) => Promise<void> {
	return (settings) => requestChartSettingsSave({ block, settings });
}

function useChartPlugin(chartType: string): PluginState {
	const [settled, setSettled] = React.useState<{ chartType: string; state: PluginState } | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		const settle = (state: PluginState) => {
			if (!cancelled) {
				setSettled({ chartType, state });
			}
		};
		loadChartPlugin(chartType).then(
			(module) => settle({ status: 'ready', module, error: null }),
			(error: unknown) => settle({ status: 'error', module: null, error: describeError(error) }),
		);
		return () => {
			cancelled = true;
		};
	}, [chartType]);

	return settled?.chartType === chartType ? settled.state : LOADING_PLUGIN;
}

function loadChartPlugin(chartType: string): Promise<ChartPluginModule> {
	const cached = pluginModules.get(chartType);
	if (cached) {
		return cached;
	}
	const request = requestChartPlugin(chartType).then(importChartPlugin);
	pluginModules.set(chartType, request);
	request.catch(() => {
		if (pluginModules.get(chartType) === request) {
			pluginModules.delete(chartType);
		}
	});
	return request;
}

async function importChartPlugin(source: string): Promise<ChartPluginModule> {
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	try {
		const loaded: unknown = await import(/* @vite-ignore */ url);
		if (!isChartPluginModule(loaded)) {
			throw new Error('The module must export a render(element, context) function.');
		}
		return loaded;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function isChartPluginModule(value: unknown): value is ChartPluginModule {
	return typeof value === 'object' && value !== null && typeof (value as { render?: unknown }).render === 'function';
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
