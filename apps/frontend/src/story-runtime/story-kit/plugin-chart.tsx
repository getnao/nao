import { storyThemeMode } from '@nao/shared/story-theme';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Recharts from 'recharts';

import { requestChartPlugin } from '../story-host';
import { resolveSeriesPalette } from '../story-colors';
import { Block, BlockState } from './block';
import { resolveChart, toSeriesConfigs } from './block-config';
import { useStoryTheme } from './hooks';
import { useBlockData } from './use-block-data';
import type { ChartPluginCleanup, ChartPluginModule, ChartPluginRenderContext } from '@nao/shared/chart-plugin';
import type { ChartProps } from './chart-shared';
import type { Row } from './use-block-data';

interface PluginChartBlockProps extends ChartProps {
	kind: string;
	chartType: string;
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
	queryId,
	data,
	height = DEFAULT_CHART_HEIGHT,
	title,
	description,
	className,
	style,
	...options
}: PluginChartBlockProps) {
	const source = useBlockData({ queryId, data });
	const resolved = source.status === 'ready' ? resolveChart(source.rows, source.columns, options) : null;

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
}

function PluginChartBody({ chartType, height, rows, config }: PluginChartBodyProps) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const plugin = useChartPlugin(chartType);
	const theme = useStoryTheme();
	const [renderError, setRenderError] = React.useState<string | null>(null);
	const configKey = JSON.stringify(config);

	const context = React.useMemo<ChartPluginRenderContext>(
		() => ({
			data: rows,
			config: JSON.parse(configKey) as ChartPluginRenderContext['config'],
			libs: { React, ReactDOM, Recharts },
			theme: theme ? storyThemeMode(theme) : 'light',
			colors: resolveSeriesPalette(),
		}),
		[rows, configKey, theme],
	);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container || !plugin.module) {
			return;
		}
		const element = appendDrawTarget(container);
		let disposed = false;
		let cleanup: ChartPluginCleanup;
		setRenderError(null);
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
			});
		return () => {
			disposed = true;
			cleanup?.();
			element.remove();
		};
	}, [plugin.module, context]);

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
