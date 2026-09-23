import * as React from 'react';
import type { LegendProps, Tooltip } from 'recharts';
import type { Payload } from 'recharts/types/component/DefaultLegendContent';

import { formatPercentShare, sumPercentStackBase } from './chart-builder';
import { CHART_NUMBER_LOCALE, formatChartValue } from './chart-values';
import { type ClassNameMerger, joinClassNames } from './class-names';
import type * as displayChart from './tools/display-chart';

export const CHART_THEMES = { light: '', dark: '.dark' } as const;

export type ChartConfig = {
	[k in string]: {
		label?: React.ReactNode;
		icon?: React.ComponentType;
		isTotal?: boolean;
		valueFormat?: displayChart.ValueFormat;
	} & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof CHART_THEMES, string> });
};

interface ChartContextProps {
	config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function ChartConfigProvider({ config, children }: { config: ChartConfig; children: React.ReactNode }) {
	const value = React.useMemo(() => ({ config }), [config]);
	return <ChartContext.Provider value={value}>{children}</ChartContext.Provider>;
}

export function useChart(): ChartContextProps {
	const context = React.useContext(ChartContext);

	if (!context) {
		throw new Error('useChart must be used within a <ChartConfigProvider />');
	}

	return context;
}

type TooltipContentProps = React.ComponentProps<typeof Tooltip> &
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
		cn?: ClassNameMerger;
	};

/** `nao-chart-tooltip__*` classes let surfaces without Tailwind (sandboxed custom stories) style the same markup. */
export function ChartTooltipContent({
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
	cn = joinClassNames,
}: TooltipContentProps) {
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
		const labelClasses = cn('nao-chart-tooltip__label font-medium', labelClassName);

		if (labelFormatter) {
			return <div className={labelClasses}>{labelFormatter(value, payload)}</div>;
		}

		if (value === undefined || value === null || value === '') {
			return null;
		}

		return <div className={labelClasses}>{value}</div>;
	}, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey, cn]);

	if (!active || !payload?.length) {
		return null;
	}

	const nestLabel = payload.length === 1 && indicator !== 'dot';

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
				'nao-chart-tooltip border-border/50 bg-background grid min-w-32 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl',
				className,
			)}
		>
			{!nestLabel ? tooltipLabel : null}
			<div className='nao-chart-tooltip__items grid gap-1.5'>
				{visiblePayload.map((item, index) => {
					const key = `${nameKey || item.name || item.dataKey || 'value'}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);
					const indicatorColor = color || item.payload.fill || item.color;

					return (
						<div
							key={item.dataKey}
							className={cn(
								'nao-chart-tooltip__item [&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5',
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
													`nao-chart-tooltip__indicator nao-chart-tooltip__indicator--${indicator} shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)`,
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
											'nao-chart-tooltip__row flex flex-1 justify-between leading-none gap-2',
											nestLabel ? 'items-end' : 'items-center',
										)}
									>
										<div className='grid gap-1.5'>
											{nestLabel ? tooltipLabel : null}
											<span className='nao-chart-tooltip__name text-muted-foreground'>
												{itemConfig?.label || item.name}
											</span>
										</div>
										{item.value !== undefined && item.value !== null && (
											<span className='nao-chart-tooltip__value text-foreground font-mono font-medium tabular-nums'>
												{formatTooltipValue(item.value, {
													percent,
													shareBase,
													valueFormatter,
													valueFormat: itemConfig?.valueFormat,
												})}
											</span>
										)}
									</div>
								</>
							)}
						</div>
					);
				})}
				{showTotal && (
					<div className='nao-chart-tooltip__total flex w-full items-center gap-2 border-t border-border/50 pt-1.5 mt-0.5'>
						<div className='nao-chart-tooltip__row flex flex-1 justify-between leading-none gap-2 items-center'>
							<span className='nao-chart-tooltip__name text-muted-foreground font-medium'>Total</span>
							<span className='nao-chart-tooltip__value text-foreground font-mono font-medium tabular-nums'>
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

type LegendContentProps = React.ComponentProps<'div'> &
	Pick<LegendProps, 'verticalAlign' | 'layout' | 'align'> & {
		hideIcon?: boolean;
		nameKey?: string;
		onItemClick?: (dataKey: string) => void;
		payload?: (Payload & { isHidden?: boolean })[];
		cn?: ClassNameMerger;
	};

/** `nao-chart-legend__*` classes let surfaces without Tailwind (sandboxed custom stories) style the same markup. */
export function ChartLegendContent({
	className,
	hideIcon = false,
	payload,
	verticalAlign = 'bottom',
	layout = 'horizontal',
	align = 'center',
	nameKey,
	onItemClick,
	cn = joinClassNames,
}: LegendContentProps) {
	const { config } = useChart();

	if (!payload?.length) {
		return null;
	}

	const isVertical = layout === 'vertical';

	return (
		<div
			className={cn(
				'nao-chart-legend flex gap-4',
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
								'nao-chart-legend__item [&>svg]:text-muted-foreground flex shrink-0 items-center gap-1.5 whitespace-nowrap [&>svg]:h-3 [&>svg]:w-3 text-muted-foreground select-none',
								onItemClick && 'nao-chart-legend__item--clickable cursor-pointer hover:text-foreground',
								item.isHidden && 'nao-chart-legend__item--hidden opacity-40',
							)}
							onClick={() => onItemClick?.(dataKey)}
						>
							{itemConfig?.icon && !hideIcon ? (
								<itemConfig.icon />
							) : (
								<div
									className='nao-chart-legend__swatch h-2 w-2 shrink-0 rounded-[2px]'
									style={{ backgroundColor: item.color }}
								/>
							)}
							{itemConfig?.label}
						</div>
					);
				})}
		</div>
	);
}

interface TooltipValueOptions {
	percent: boolean;
	shareBase: number;
	valueFormatter?: (value: number) => string;
	valueFormat?: displayChart.ValueFormat;
}

function formatTooltipValue(value: unknown, { percent, shareBase, valueFormatter, valueFormat }: TooltipValueOptions) {
	if (typeof value !== 'number') {
		return (value as { toLocaleString: (locale: string) => string }).toLocaleString(CHART_NUMBER_LOCALE);
	}
	if (percent) {
		return formatPercentShare(value, shareBase);
	}
	return valueFormatter ? valueFormatter(value) : formatChartValue(value, valueFormat, { compact: true });
}

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
