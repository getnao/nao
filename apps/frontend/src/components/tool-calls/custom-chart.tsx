import { DEFAULT_COLORS } from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Recharts from 'recharts';
import type { ChartPluginCleanup, ChartPluginModule, ChartPluginRenderContext } from '@nao/shared';
import type { displayChart } from '@nao/shared/tools';

import { useTheme } from '@/contexts/theme.provider';
import { trpc } from '@/main';

const PLUGIN_REFRESH_INTERVAL_MS = 2_000;

export const CustomChart = React.memo(function CustomChart({
	config,
	data,
}: {
	config: displayChart.ChartInput;
	data: Record<string, unknown>[];
}) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const { theme } = useTheme();
	const [module, setModule] = React.useState<ChartPluginModule | null>(null);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [renderError, setRenderError] = React.useState<string | null>(null);

	const manifest = useQuery({
		...trpc.chartPlugin.list.queryOptions(),
		refetchInterval: PLUGIN_REFRESH_INTERVAL_MS,
		staleTime: 0,
	});
	const plugin = manifest.data?.find((entry) => entry.type === config.chart_type);
	const source = useQuery({
		...trpc.chartPlugin.source.queryOptions({
			type: config.chart_type,
			version: plugin?.version ?? '',
		}),
		enabled: Boolean(plugin),
		staleTime: Infinity,
	});

	React.useEffect(() => {
		setModule(null);
		setLoadError(null);
		if (!source.data) {
			return;
		}

		let active = true;
		const moduleUrl = URL.createObjectURL(new Blob([source.data.source], { type: 'text/javascript' }));
		void import(/* @vite-ignore */ moduleUrl)
			.then((loaded: unknown) => {
				if (!active) {
					return;
				}
				if (!isChartPluginModule(loaded)) {
					throw new Error('The module must export a render(element, context) function.');
				}
				setModule(loaded);
			})
			.catch((error: unknown) => {
				if (active) {
					setLoadError(toErrorMessage(error));
				}
			})
			.finally(() => URL.revokeObjectURL(moduleUrl));

		return () => {
			active = false;
			URL.revokeObjectURL(moduleUrl);
		};
	}, [source.data]);

	const renderContext = React.useMemo<ChartPluginRenderContext>(
		() => ({
			data,
			config: {
				chartType: config.chart_type,
				xAxisKey: config.x_axis_key,
				xAxisType: config.x_axis_type,
				series: config.series,
				title: config.title,
			},
			libs: { React, ReactDOM, Recharts },
			theme: resolveTheme(theme),
			colors: DEFAULT_COLORS,
		}),
		[config, data, theme],
	);

	React.useEffect(() => {
		const element = containerRef.current;
		if (!element || !module) {
			return;
		}

		let disposed = false;
		let cleanup: ChartPluginCleanup;
		setRenderError(null);
		Promise.resolve(module.render(element, renderContext))
			.then((nextCleanup) => {
				if (disposed) {
					nextCleanup?.();
				} else {
					cleanup = nextCleanup;
				}
			})
			.catch((error: unknown) => {
				if (!disposed) {
					setRenderError(toErrorMessage(error));
				}
			});

		return () => {
			disposed = true;
			cleanup?.();
			element.replaceChildren();
		};
	}, [module, renderContext]);

	const error = loadError ?? renderError ?? (manifest.error ? toErrorMessage(manifest.error) : null);
	if (error) {
		return <ChartPluginMessage>Could not render custom chart: {error}</ChartPluginMessage>;
	}
	if (manifest.isPending) {
		return <ChartPluginMessage>Loading custom chart...</ChartPluginMessage>;
	}
	if (!plugin) {
		return <ChartPluginMessage>Custom chart &quot;{config.chart_type}&quot; is not available.</ChartPluginMessage>;
	}
	if (source.isPending || !module) {
		return <ChartPluginMessage>Loading custom chart...</ChartPluginMessage>;
	}

	return <div ref={containerRef} className='h-full min-h-64 w-full' />;
});

function ChartPluginMessage({ children }: { children: React.ReactNode }) {
	return <div className='flex min-h-64 items-center justify-center text-sm text-muted-foreground'>{children}</div>;
}

function isChartPluginModule(value: unknown): value is ChartPluginModule {
	return typeof value === 'object' && value !== null && typeof (value as { render?: unknown }).render === 'function';
}

function resolveTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
	if (theme !== 'system') {
		return theme;
	}
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
