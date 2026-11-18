import {
	CHART_THEMES,
	ChartConfigProvider,
	ChartLegendContent as SharedChartLegendContent,
	ChartTooltipContent as SharedChartTooltipContent,
} from '@nao/shared/chart-tooltip';
import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import type { ChartConfig } from '@nao/shared/chart-tooltip';

import { cn } from '@/lib/utils';

function ChartContainer({
	id,
	className,
	contentClassName,
	header,
	children,
	config,
	...props
}: React.ComponentProps<'div'> & {
	config: ChartConfig;
	contentClassName?: string;
	header?: React.ReactNode;
	children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
	const uniqueId = React.useId();
	const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;

	return (
		<ChartConfigProvider config={config}>
			<div data-slot='chart' data-chart={chartId} className={cn('flex w-full flex-col', className)} {...props}>
				{header}
				<div
					className={cn(
						"[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video min-h-0 justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
						contentClassName,
					)}
				>
					<ChartStyle id={chartId} config={config} />
					<RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
				</div>
			</div>
		</ChartConfigProvider>
	);
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
	const colorConfig = Object.entries(config).filter(([, c]) => c.theme || c.color);

	if (!colorConfig.length) {
		return null;
	}

	return (
		<style
			dangerouslySetInnerHTML={{
				__html: Object.entries(CHART_THEMES)
					.map(
						([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
	.map(([key, itemConfig]) => {
		const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color;
		return color ? `  --color-${key}: ${color};` : null;
	})
	.join('\n')}
}
`,
					)
					.join('\n'),
			}}
		/>
	);
};

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent(props: React.ComponentProps<typeof SharedChartTooltipContent>) {
	return <SharedChartTooltipContent cn={cn} {...props} />;
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent(props: React.ComponentProps<typeof SharedChartLegendContent>) {
	return <SharedChartLegendContent cn={cn} {...props} />;
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartStyle, ChartTooltip, ChartTooltipContent };
