import { CHART_NUMBER_LOCALE, formatChartValue, formatPercentShare, sumPercentStackBase } from '@nao/shared';
import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import type { Payload } from 'recharts/types/component/DefaultLegendContent';
import type { displayChart } from '@nao/shared/tools';

import { cn } from '@/lib/utils';

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: '', dark: '.dark' } as const;

export type ChartConfig = {
	[k in string]: {
		label?: React.ReactNode;
		icon?: React.ComponentType;
		isTotal?: boolean;
		valueFormat?: displayChart.ValueFormat;
	} & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof THEMES, string> });
};

type ChartContextProps = {
	config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
	const context = React.useContext(ChartContext);

	if (!context) {
		throw new Error('useChart must be used within a <ChartContainer />');
	}

	return context;
}

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
		<ChartContext.Provider value={{ config }}>
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
		</ChartContext.Provider>
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
				__html: Object.entries(THEMES)
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

function ChartTooltipContent({
	active,
	payload,
	className,
	indicator = 'dot',
	hideLabel = false,
	hideIndicator = false,
	label,
	labelFormatter,
	labelClassName,
	formatter,
	color,
	nameKey,
	labelKey,
	percent = false,
	valueFormatter,
	isDualAxis = false,
	hideTotal = false,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
	React.ComponentProps<'div'> & {
		hideLabel?: boolean;
		hideIndicator?: boolean;
		indicator?: 'line' | 'dot' | 'dashed';
		nameKey?: string;
		labelKey?: string;
		percent?: boolean;
		valueFormatter?: (value: number) => string;
		isDualAxis?: boolean;
		hideTotal?: boolean;
	}) {
	const { config } = useChart();

	const tooltipLabel = React.useMemo(() => {
		if (hideLabel || !payload?.length) {
			return null;
		}

		const [item] = payload;
		const key = `${labelKey || item?.dataKey || item?.name || 'value'}`;
		const itemConfig = getPayloadConfigFromPayload(config, item, key);
		const isAxisValue = !labelKey && (typeof label === 'string' || typeof label === 'number');
		const value = isAxisValue ? config[String(label)]?.label || label : itemConfig?.label;

		if (labelFormatter) {
			return <div className={cn('font-medium', labelClassName)}>{labelFormatter(value, payload)}</div>;
		}

		if (value === undefined || value === null || value === '') {
			return null;
		}

		return <div className={cn('font-medium', labelClassName)}>{value}</div>;
	}, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

	if (!active || !payload?.length) {
		return null;
	}

	const nestLabel = payload.length === 1 && indicator !== 'dot';

	// Calculate total if there are multiple numeric values that can be summed and no total column.
	const visiblePayload = payload.filter((item) => item.type !== 'none');
	const isTotalItem = (item: (typeof visiblePayload)[number]) => {
		const key = `${nameKey || item.name || item.dataKey || 'value'}`;
		return getPayloadConfigFromPayload(config, item, key)?.isTotal === true;
	};
	const numericValues = visiblePayload.map((item) => item.value).filter((v): v is number => typeof v === 'number');
	const hasTotalSeries = visiblePayload.some(isTotalItem);
	const seriesTotal = numericValues.reduce((sum, v) => sum + v, 0);
	// 100% shares are relative to the stacked (non-total) series only, so each category sums to 100%.
	const shareBase = sumPercentStackBase(
		visiblePayload
			.filter((item) => typeof item.value === 'number')
			.map((item) => ({ value: item.value as number, isTotal: isTotalItem(item) })),
	);
	// In 100% stacked mode every category totals 100%, so ignore already-aggregated total series.
	const showTotal = !isDualAxis && numericValues.length > 1 && (percent || (!hasTotalSeries && !hideTotal));
	const firstItem = visiblePayload[0];
	const firstItemKey = `${nameKey || firstItem?.name || firstItem?.dataKey || 'value'}`;
	const firstItemFormat = getPayloadConfigFromPayload(config, firstItem, firstItemKey)?.valueFormat;

	return (
		<div
			className={cn(
				'border-border/50 bg-background grid min-w-32 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl',
				className,
			)}
		>
			{!nestLabel ? tooltipLabel : null}
			<div className='grid gap-1.5'>
				{visiblePayload.map((item, index) => {
					const key = `${nameKey || item.name || item.dataKey || 'value'}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);
					const indicatorColor = color || item.payload.fill || item.color;

					return (
						<div
							key={item.dataKey}
							className={cn(
								'[&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5',
								indicator === 'dot' && 'items-center',
							)}
						>
							{formatter && item?.value !== undefined && item.name ? (
								formatter(item.value, item.name, item, index, item.payload)
							) : (
								<>
									{itemConfig?.icon ? (
										<itemConfig.icon />
									) : (
										!hideIndicator && (
											<div
												className={cn(
													'shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)',
													{
														'h-2.5 w-2.5': indicator === 'dot',
														'w-1': indicator === 'line',
														'w-0 border-[1.5px] border-dashed bg-transparent':
															indicator === 'dashed',
														'my-0.5': nestLabel && indicator === 'dashed',
													},
												)}
												style={
													{
														'--color-bg': indicatorColor,
														'--color-border': indicatorColor,
													} as React.CSSProperties
												}
											/>
										)
									)}
									<div
										className={cn(
											'flex flex-1 justify-between leading-none gap-2',
											nestLabel ? 'items-end' : 'items-center',
										)}
									>
										<div className='grid gap-1.5'>
											{nestLabel ? tooltipLabel : null}
											<span className='text-muted-foreground'>
												{itemConfig?.label || item.name}
											</span>
										</div>
										{item.value !== undefined && item.value !== null && (
											<span className='text-foreground font-mono font-medium tabular-nums'>
												{typeof item.value === 'number'
													? percent
														? formatPercentShare(item.value, shareBase)
														: valueFormatter
															? valueFormatter(item.value)
															: formatChartValue(item.value, itemConfig?.valueFormat, {
																	compact: true,
																})
													: item.value.toLocaleString(CHART_NUMBER_LOCALE)}
											</span>
										)}
									</div>
								</>
							)}
						</div>
					);
				})}
				{showTotal && (
					<div className='flex w-full items-center gap-2 border-t border-border/50 pt-1.5 mt-0.5'>
						<div className='flex flex-1 justify-between leading-none gap-2 items-center'>
							<span className='text-muted-foreground font-medium'>Total</span>
							<span className='text-foreground font-mono font-medium tabular-nums'>
								{percent
									? '100%'
									: valueFormatter
										? valueFormatter(seriesTotal)
										: formatChartValue(seriesTotal, firstItemFormat, { compact: true })}
							</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
	className,
	hideIcon = false,
	payload,
	verticalAlign = 'bottom',
	layout = 'horizontal',
	align = 'center',
	nameKey,
	onItemClick,
}: React.ComponentProps<'div'> &
	Pick<RechartsPrimitive.LegendProps, 'verticalAlign' | 'layout' | 'align'> & {
		hideIcon?: boolean;
		nameKey?: string;
		onItemClick?: (dataKey: string) => void;
		payload?: (Payload & { isHidden: boolean })[];
	}) {
	const { config } = useChart();

	if (!payload?.length) {
		return null;
	}

	const isVertical = layout === 'vertical';

	return (
		<div
			className={cn(
				'flex gap-4',
				isVertical
					? 'flex-col items-start justify-center gap-2 pl-4'
					: cn(
							'w-full items-center',
							align === 'right' ? 'justify-end' : align === 'left' ? 'justify-start' : 'justify-center',
							verticalAlign === 'top' ? 'pb-3' : 'pt-3',
						),
				className,
			)}
		>
			{payload
				.filter((item) => item.type !== 'none')
				.map((item) => {
					const key = `${nameKey || item.dataKey || 'value'}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);
					const dataKey = String(item.dataKey);

					return (
						<div
							key={item.value}
							className={cn(
								'[&>svg]:text-muted-foreground flex shrink-0 items-center gap-1.5 whitespace-nowrap [&>svg]:h-3 [&>svg]:w-3 text-muted-foreground select-none',
								onItemClick && 'cursor-pointer hover:text-foreground',
								item.isHidden && 'opacity-40',
							)}
							onClick={() => onItemClick?.(dataKey)}
						>
							{itemConfig?.icon && !hideIcon ? (
								<itemConfig.icon />
							) : (
								<div
									className='h-2 w-2 shrink-0 rounded-[2px]'
									style={{
										backgroundColor: item.color,
									}}
								/>
							)}
							{itemConfig?.label}
						</div>
					);
				})}
		</div>
	);
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
	if (typeof payload !== 'object' || payload === null) {
		return undefined;
	}

	const payloadPayload =
		'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null
			? payload.payload
			: undefined;

	let configLabelKey: string = key;

	if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
		configLabelKey = payload[key as keyof typeof payload] as string;
	} else if (
		payloadPayload &&
		key in payloadPayload &&
		typeof payloadPayload[key as keyof typeof payloadPayload] === 'string'
	) {
		configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
	}

	return configLabelKey in config ? config[configLabelKey] : config[key];
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartStyle, ChartTooltip, ChartTooltipContent };
