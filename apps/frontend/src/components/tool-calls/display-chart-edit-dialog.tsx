import { computeKpiComparison, DEFAULT_COLORS } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartArea, ChartBar, ChartColumn, ChartColumnIncreasing, ChartLine, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { LucideIcon } from 'lucide-react';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { trpc } from '@/main';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { cn } from '@/lib/utils';

const CHART_TYPE_OPTIONS: { value: displayChart.ChartType; label: string }[] = [
	{ value: 'bar', label: 'Bar' },
	{ value: 'stacked_bar', label: 'Stacked bar' },
	{ value: 'line', label: 'Line' },
	{ value: 'area', label: 'Area' },
	{ value: 'stacked_area', label: 'Stacked area' },
	{ value: 'mixed', label: 'Mixed' },
	{ value: 'pie', label: 'Pie' },
	{ value: 'donut', label: 'Donut' },
	{ value: 'kpi_card', label: 'KPI card' },
	{ value: 'scatter', label: 'Scatter' },
	{ value: 'radar', label: 'Radar' },
];

const X_AXIS_TYPE_OPTIONS: { value: NonNullable<displayChart.XAxisType> | 'auto'; label: string }[] = [
	{ value: 'auto', label: 'Auto' },
	{ value: 'category', label: 'Category' },
	{ value: 'date', label: 'Date' },
	{ value: 'number', label: 'Number' },
];

const COMPARISON_MODE_OPTIONS: { value: displayChart.ComparisonMode; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'percentage', label: 'Percentage' },
	{ value: 'variation', label: 'Variation' },
	{ value: 'absolute', label: 'Absolute' },
];

const SERIES_TYPE_OPTIONS: { value: displayChart.SeriesType; label: string; icon: LucideIcon }[] = [
	{ value: 'bar', label: 'Bar', icon: ChartColumnIncreasing },
	{ value: 'line', label: 'Line', icon: ChartLine },
	{ value: 'area', label: 'Area', icon: ChartArea },
];

const Y_AXIS_RANGE_UNSUPPORTED_CHART_TYPES = new Set<displayChart.ChartType>(['pie', 'kpi_card', 'radar']);

type UnitPlacement = 'prefix' | 'suffix';

type EditableChartInput = Omit<displayChart.KpiCardInput, 'chart_type'> & { chart_type: displayChart.ChartType };

/** Maps a 100% stacked type back to its absolute-stacked counterpart, so the type dropdown stays clean. */
function baseChartType(type: displayChart.ChartType): displayChart.ChartType {
	if (type === 'stacked_bar_100') {
		return 'stacked_bar';
	}
	if (type === 'stacked_area_100') {
		return 'stacked_area';
	}
	return type;
}

/** Maps a stacked type to its 100% (normalized) counterpart. */
function percentChartType(type: displayChart.ChartType): displayChart.ChartType {
	if (type === 'stacked_bar' || type === 'stacked_bar_100') {
		return 'stacked_bar_100';
	}
	if (type === 'stacked_area' || type === 'stacked_area_100') {
		return 'stacked_area_100';
	}
	return type;
}

/** Shifts open Format-panel indexes to stay aligned after the series at `removedIndex` is removed. */
function remapOpenIndexesAfterRemoval(openIndexes: Set<number>, removedIndex: number): Set<number> {
	const next = new Set<number>();
	for (const openIndex of openIndexes) {
		if (openIndex === removedIndex) {
			continue;
		}
		next.add(openIndex > removedIndex ? openIndex - 1 : openIndex);
	}
	return next;
}

interface ChartConfigEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config: EditableChartInput;
	availableColumns: string[];
	onSave: (next: EditableChartInput) => Promise<void>;
	isSaving?: boolean;
	description?: string;
	data?: Record<string, unknown>[];
}

/** Presentational edit dialog for `display_chart` configuration. */
export function ChartConfigEditDialog({
	open,
	onOpenChange,
	config,
	availableColumns,
	onSave,
	isSaving = false,
	description = 'Tweak the chart parameters.',
	data,
}: ChartConfigEditDialogProps) {
	const [draft, setDraft] = useState<EditableChartInput>(config);
	const [yAxisMinText, setYAxisMinText] = useState(toRangeString(config.y_axis_min));
	const [yAxisMaxText, setYAxisMaxText] = useState(toRangeString(config.y_axis_max));
	const [yAxisRightMinText, setYAxisRightMinText] = useState(toRangeString(config.y_axis_right_min));
	const [yAxisRightMaxText, setYAxisRightMaxText] = useState(toRangeString(config.y_axis_right_max));
	const [error, setError] = useState<string | null>(null);
	const [openValueFormatIndexes, setOpenValueFormatIndexes] = useState<Set<number>>(new Set());
	// Chart palette resolved to hex so a series without an explicit color shows
	// the same swatch the chart draws for it. Refreshed on open for the theme.
	const [paletteHexes, setPaletteHexes] = useState<string[]>(DEFAULT_COLORS);
	const supportsYAxisRange = !Y_AXIS_RANGE_UNSUPPORTED_CHART_TYPES.has(draft.chart_type);
	const supportsAxisLabels = displayChart.chartTypeSupportsAxisLabels(draft.chart_type);
	const unsupportedNumberFormat = useMemo(
		() =>
			draft.series
				.map((series) => series.value_format?.d3_format)
				.find((format) => Boolean(format) && !isExportSafeNumberFormat(format as string)),
		[draft.series],
	);
	const canShowComparisonPill = useMemo(
		() => draft.chart_type === 'kpi_card' && hasRenderableKpiComparison(data, draft.x_axis_key, draft.series),
		[draft.chart_type, draft.x_axis_key, draft.series, data],
	);
	const isCombo = displayChart.chartTypeSupportsComboSeries(draft.chart_type);
	const hasRightAxis = isCombo && displayChart.hasRightAxisSeries(draft.series);
	const hasLeftAxis = !isCombo || draft.series.some((s) => s.y_axis !== 'right');

	useEffect(() => {
		if (open) {
			setDraft(config);
			setYAxisMinText(toRangeString(config.y_axis_min));
			setYAxisMaxText(toRangeString(config.y_axis_max));
			setYAxisRightMinText(toRangeString(config.y_axis_right_min));
			setYAxisRightMaxText(toRangeString(config.y_axis_right_max));
			setPaletteHexes(resolveChartPaletteHexes());
			setError(null);
			setOpenValueFormatIndexes(new Set());
		}
	}, [open, config]);

	const xAxisOptions = useMemo(() => {
		if (availableColumns.length === 0) {
			return [config.x_axis_key ?? ''];
		}
		return availableColumns;
	}, [availableColumns, config.x_axis_key]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (unsupportedNumberFormat) {
			setError(UNSUPPORTED_NUMBER_FORMAT_MESSAGE);
			return;
		}

		const normalized: EditableChartInput =
			draft.chart_type === 'kpi_card'
				? { ...draft, x_axis_key: draft.x_axis_key || '', x_axis_type: draft.x_axis_type ?? null }
				: draft;
		const parsed = displayChart.InputSchema.safeParse(normalized);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? 'Invalid chart configuration.');
			return;
		}
		if (displayChart.isTableInput(parsed.data)) {
			setError('Invalid chart configuration.');
			return;
		}
		if (!displayChart.isBuiltinChartType(parsed.data.chart_type)) {
			setError('Custom charts cannot be edited here.');
			return;
		}

		try {
			await onSave({ ...parsed.data, chart_type: parsed.data.chart_type });
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update chart.');
		}
	};

	const updateSeriesAt = (index: number, patch: Partial<displayChart.SeriesConfig>) => {
		setDraft((prev) => ({
			...prev,
			series: prev.series.map((s, i) => (i === index ? { ...s, ...patch } : s)),
		}));
	};

	const updateSeriesValueFormatAt = (index: number, field: 'd3_format' | 'prefix' | 'suffix', value: string) => {
		const series = draft.series[index];
		const nextValueFormat = { ...series.value_format, [field]: value || undefined };
		updateSeriesAt(index, { value_format: cleanValueFormat(nextValueFormat) });
	};

	const setSeriesUnit = (index: number, { unit, placement }: { unit: string; placement: UnitPlacement }) => {
		const series = draft.series[index];
		const nextValueFormat = {
			...series.value_format,
			prefix: placement === 'prefix' ? unit || undefined : undefined,
			suffix: placement === 'suffix' ? unit || undefined : undefined,
		};
		updateSeriesAt(index, { value_format: cleanValueFormat(nextValueFormat) });
	};

	const toggleValueFormat = (index: number) => {
		setOpenValueFormatIndexes((previous) => {
			const next = new Set(previous);
			if (next.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			return next;
		});
	};

	const removeSeriesAt = (index: number) => {
		setDraft((prev) => {
			if (prev.series.length <= 1) {
				return prev;
			}
			return { ...prev, series: prev.series.filter((_, i) => i !== index) };
		});
		setOpenValueFormatIndexes((previous) => remapOpenIndexesAfterRemoval(previous, index));
	};

	const addSeries = () => {
		const used = new Set(draft.series.map((s) => s.data_key));
		const selectableColumns = getSelectableColumns(availableColumns);
		const fallback = selectableColumns.find((c) => c !== draft.x_axis_key && !used.has(c)) ?? selectableColumns[0];
		if (!fallback) {
			setError('No columns are available to add as a series.');
			return;
		}

		setError(null);
		setDraft((prev) => ({
			...prev,
			series: [...prev.series, { data_key: fallback }],
		}));
	};

	const updateYAxisMin = (value: string) => {
		setYAxisMinText(value);
		const parsed = parseRangeInput(value);
		setDraft((prev) => ({ ...prev, y_axis_min: parsed }));
	};

	const updateYAxisMax = (value: string) => {
		setYAxisMaxText(value);
		const parsed = parseRangeInput(value);
		setDraft((prev) => ({ ...prev, y_axis_max: parsed }));
	};

	const updateYAxisRightMin = (value: string) => {
		setYAxisRightMinText(value);
		const parsed = parseRangeInput(value);
		setDraft((prev) => ({ ...prev, y_axis_right_min: parsed }));
	};

	const updateYAxisRightMax = (value: string) => {
		setYAxisRightMaxText(value);
		const parsed = parseRangeInput(value);
		setDraft((prev) => ({ ...prev, y_axis_right_max: parsed }));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-xl max-h-[90vh] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>Edit chart</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						{description}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
					<div className='grid gap-2'>
						<label htmlFor='chart-title' className='text-sm font-semibold text-foreground'>
							Title
						</label>
						<Input
							id='chart-title'
							className='h-8 bg-panel'
							value={draft.title}
							onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
							placeholder='Chart title'
						/>
					</div>

					<div className='grid gap-2'>
						<span className='text-sm font-semibold text-foreground'>Chart type</span>
						<Select
							value={baseChartType(draft.chart_type)}
							onValueChange={(value) =>
								setDraft((prev) => {
									const nextBase = value as displayChart.ChartType;
									const keepPercent =
										displayChart.isPercentStackedChartType(prev.chart_type) &&
										displayChart.isStackedChartType(nextBase);
									return {
										...prev,
										chart_type: keepPercent ? percentChartType(nextBase) : nextBase,
									};
								})
							}
						>
							<SelectTrigger className='w-full bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent className='border-none bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
								{CHART_TYPE_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{displayChart.isStackedChartType(draft.chart_type) && (
						<div className='flex items-center justify-between gap-3'>
							<div className='grid gap-0.5'>
								<label htmlFor='chart-normalize' className='text-sm font-semibold text-foreground'>
									Normalize to 100%
								</label>
								<span className='text-xs text-muted-foreground'>
									Show each series as a share of the category total.
								</span>
							</div>
							<Switch
								id='chart-normalize'
								checked={displayChart.isPercentStackedChartType(draft.chart_type)}
								onCheckedChange={(checked) =>
									setDraft((prev) => ({
										...prev,
										chart_type: checked
											? percentChartType(prev.chart_type)
											: baseChartType(prev.chart_type),
									}))
								}
							/>
						</div>
					)}

					{draft.chart_type !== 'kpi_card' && (
						<div className='grid gap-3 py-2'>
							<span className='text-sm font-semibold text-foreground'>X-axis</span>
							<div
								className={`grid gap-3 items-end ${supportsAxisLabels ? 'grid-cols-[1fr_1fr_1fr]' : 'grid-cols-[1fr_1fr]'}`}
							>
								<div className='grid gap-1'>
									<span className='text-xs text-muted-foreground'>Column</span>
									<ColumnSelect
										value={draft.x_axis_key ?? ''}
										columns={xAxisOptions}
										onChange={(value) => setDraft((prev) => ({ ...prev, x_axis_key: value }))}
									/>
								</div>
								{supportsAxisLabels && (
									<div className='grid gap-1'>
										<span className='text-xs text-muted-foreground'>Label</span>
										<Input
											className='h-8 bg-panel'
											placeholder='Label (optional)'
											value={draft.x_axis_label ?? ''}
											onChange={(e) =>
												setDraft((prev) => ({
													...prev,
													x_axis_label: e.target.value || undefined,
												}))
											}
										/>
									</div>
								)}
								<div className='grid gap-1'>
									<span className='text-xs text-muted-foreground'>Type</span>
									<Select
										value={draft.x_axis_type ?? 'auto'}
										onValueChange={(value) =>
											setDraft((prev) => ({
												...prev,
												x_axis_type:
													value === 'auto' ? null : (value as displayChart.XAxisType),
											}))
										}
									>
										<SelectTrigger className='w-full bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent className='border-none bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
											{X_AXIS_TYPE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>
					)}

					<div className='grid gap-2'>
						<div className='flex items-center justify-between py-2'>
							<span className='text-sm font-semibold text-foreground'>Series</span>
							<Button
								type='button'
								size='sm'
								variant='outline'
								className='rounded-full text-xs'
								onClick={addSeries}
							>
								<Plus className='size-3.5' /> Add series
							</Button>
						</div>
						<div className='flex flex-col gap-3'>
							{draft.series.map((series, index) => {
								const placement: UnitPlacement = series.value_format?.prefix ? 'prefix' : 'suffix';
								const unit =
									placement === 'prefix'
										? (series.value_format?.prefix ?? '')
										: (series.value_format?.suffix ?? '');
								const isOpen = openValueFormatIndexes.has(index);
								const row = (
									<div
										className={`grid ${isCombo ? 'grid-cols-[1fr_1fr_auto_auto_auto_auto]' : 'grid-cols-[1fr_1fr_auto_auto_auto]'} gap-2 items-center`}
									>
										<ColumnSelect
											value={series.data_key}
											columns={availableColumns.length > 0 ? availableColumns : [series.data_key]}
											onChange={(value) => updateSeriesAt(index, { data_key: value })}
										/>
										<Input
											value={series.label ?? ''}
											onChange={(e) =>
												updateSeriesAt(index, { label: e.target.value || undefined })
											}
											placeholder='Label (optional)'
											className='h-8 rounded-lg text-sm bg-panel'
										/>
										{isCombo && (
											<YAxisSideToggle
												value={series.y_axis ?? 'left'}
												onChange={(value) => updateSeriesAt(index, { y_axis: value })}
											/>
										)}
										<ValueFormatToggle
											unit={unit}
											open={isOpen}
											onClick={() => toggleValueFormat(index)}
										/>
										<input
											type='color'
											aria-label='Series color'
											value={normalizeHexColor(
												series.color,
												paletteHexes[index % paletteHexes.length],
											)}
											onChange={(e) => updateSeriesAt(index, { color: e.target.value })}
											className='h-8 w-8 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-none'
										/>
										<Button
											type='button'
											size='icon-sm'
											variant='ghost-muted'
											className='size-8'
											onClick={() => removeSeriesAt(index)}
											disabled={draft.series.length <= 1}
											title='Remove series'
										>
											<Trash2 className='size-4' />
										</Button>
									</div>
								);

								if (!isCombo) {
									return (
										<div key={index} className='flex flex-col gap-2 rounded-md'>
											{row}
											{isOpen && (
												<SeriesValueFormatFields
													d3Format={series.value_format?.d3_format ?? ''}
													unit={unit}
													placement={placement}
													onD3FormatChange={(value) =>
														updateSeriesValueFormatAt(index, 'd3_format', value)
													}
													onUnitChange={(nextUnit, nextPlacement) =>
														setSeriesUnit(index, {
															unit: nextUnit,
															placement: nextPlacement,
														})
													}
												/>
											)}
										</div>
									);
								}

								return (
									<fieldset key={index} className='rounded-md border border-border px-3 pt-1 pb-3'>
										<legend className='ml-1'>
											<SeriesTypeSelect
												value={series.series_type ?? 'bar'}
												onChange={(value) => updateSeriesAt(index, { series_type: value })}
											/>
										</legend>
										<div className='flex flex-col gap-2'>
											{row}
											{isOpen && (
												<SeriesValueFormatFields
													d3Format={series.value_format?.d3_format ?? ''}
													unit={unit}
													placement={placement}
													onD3FormatChange={(value) =>
														updateSeriesValueFormatAt(index, 'd3_format', value)
													}
													onUnitChange={(nextUnit, nextPlacement) =>
														setSeriesUnit(index, {
															unit: nextUnit,
															placement: nextPlacement,
														})
													}
												/>
											)}
										</div>
									</fieldset>
								);
							})}
						</div>
					</div>

					{isCombo
						? (hasLeftAxis || hasRightAxis) && (
								<div className='grid gap-3 py-2'>
									<span className='text-sm font-semibold text-foreground'>Y-axis range</span>
									{hasLeftAxis && (
										<AxisFields
											name='Left label'
											showRange={supportsYAxisRange}
											labelPlaceholder='Label (optional)'
											labelValue={draft.y_axis_label ?? ''}
											onLabelChange={(value) =>
												setDraft((prev) => ({ ...prev, y_axis_label: value || undefined }))
											}
											minId='chart-y-axis-min'
											maxId='chart-y-axis-max'
											minValue={yAxisMinText}
											maxValue={yAxisMaxText}
											onMinChange={updateYAxisMin}
											onMaxChange={updateYAxisMax}
										/>
									)}
									{hasRightAxis && (
										<AxisFields
											name='Right label'
											showRange={supportsYAxisRange}
											labelPlaceholder='Label (optional)'
											labelValue={draft.y_axis_right_label ?? ''}
											onLabelChange={(value) =>
												setDraft((prev) => ({
													...prev,
													y_axis_right_label: value || undefined,
												}))
											}
											minId='chart-y-axis-right-min'
											maxId='chart-y-axis-right-max'
											minValue={yAxisRightMinText}
											maxValue={yAxisRightMaxText}
											onMinChange={updateYAxisRightMin}
											onMaxChange={updateYAxisRightMax}
										/>
									)}
								</div>
							)
						: (supportsAxisLabels || supportsYAxisRange) && (
								<div className='grid gap-3 py-2'>
									<span className='text-sm font-semibold text-foreground'>Y-axis</span>
									{supportsAxisLabels ? (
										<AxisFields
											name='Label'
											showRange={supportsYAxisRange}
											labelPlaceholder='Label (optional)'
											labelValue={draft.y_axis_label ?? ''}
											onLabelChange={(value) =>
												setDraft((prev) => ({ ...prev, y_axis_label: value || undefined }))
											}
											minId='chart-y-axis-min'
											maxId='chart-y-axis-max'
											minValue={yAxisMinText}
											maxValue={yAxisMaxText}
											onMinChange={updateYAxisMin}
											onMaxChange={updateYAxisMax}
										/>
									) : (
										<div className='grid grid-cols-[1fr_1fr] gap-3 items-end'>
											<MinMaxFields
												minId='chart-y-axis-min'
												maxId='chart-y-axis-max'
												minValue={yAxisMinText}
												maxValue={yAxisMaxText}
												onMinChange={updateYAxisMin}
												onMaxChange={updateYAxisMax}
											/>
										</div>
									)}
								</div>
							)}

					<div className='grid gap-2'>
						<span className='text-sm font-semibold text-foreground'>Options</span>
						{canShowComparisonPill && (
							<div className='grid gap-2'>
								<span className='text-sm font-semibold text-foreground'>Comparison pill</span>
								<Select
									value={'comparison_mode' in draft ? (draft.comparison_mode ?? 'none') : 'none'}
									onValueChange={(value) =>
										setDraft((prev) => ({
											...prev,
											comparison_mode: value as displayChart.ComparisonMode,
										}))
									}
								>
									<SelectTrigger className='w-full bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent className='border-none bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
										{COMPARISON_MODE_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						<div className='flex h-8 items-center justify-between'>
							<label htmlFor='show-data-labels' className='text-sm text-foreground'>
								Show data labels
							</label>
							<Switch
								id='show-data-labels'
								checked={Boolean(draft.show_data_labels)}
								onCheckedChange={(v) => setDraft((prev) => ({ ...prev, show_data_labels: v }))}
							/>
						</div>
					</div>

					{(error || unsupportedNumberFormat) && (
						<p className='text-xs text-destructive'>{error ?? UNSUPPORTED_NUMBER_FORMAT_MESSAGE}</p>
					)}

					<DialogFooter>
						<Button
							type='button'
							variant='ghost'
							className='rounded-full border'
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							variant='primary-gradient'
							type='submit'
							className='rounded-full'
							isLoading={isSaving}
							disabled={isSaving || Boolean(unsupportedNumberFormat)}
						>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface DisplayChartEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	toolCallId: string;
	config: EditableChartInput;
	availableColumns: string[];
	data?: Record<string, unknown>[];
}

/** Edit dialog bound to a `tool-display_chart` message part: persists through `chart.updateConfig`. */
export function DisplayChartEditDialog({
	open,
	onOpenChange,
	toolCallId,
	config,
	availableColumns,
	data,
}: DisplayChartEditDialogProps) {
	const queryClient = useQueryClient();
	const { setMessages } = useAgentContext();
	const messages = useAgentMessages();

	const updateMutation = useMutation(
		trpc.chart.updateConfig.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: [['chat', 'get']] });
			},
		}),
	);

	const handleSave = async (next: EditableChartInput) => {
		const previousMessages = messages;
		setMessages(applyChartConfigToMessages(previousMessages, toolCallId, next));
		try {
			await updateMutation.mutateAsync({ toolCallId, config: next });
		} catch (err) {
			setMessages(previousMessages);
			throw err;
		}
	};

	return (
		<ChartConfigEditDialog
			open={open}
			onOpenChange={onOpenChange}
			config={config}
			availableColumns={availableColumns}
			data={data}
			onSave={handleSave}
			isSaving={updateMutation.isPending}
			description='Tweak the chart parameters. Changes are saved to the chat.'
		/>
	);
}

interface ColumnSelectProps {
	value: string;
	columns: string[];
	onChange: (value: string) => void;
}

function ColumnSelect({ value, columns, onChange }: ColumnSelectProps) {
	const columnsWithValues = getSelectableColumns(columns);
	const items = value && !columnsWithValues.includes(value) ? [value, ...columnsWithValues] : columnsWithValues;
	return (
		<Select value={value} onValueChange={onChange} disabled={items.length === 0}>
			<SelectTrigger className='w-full text-sm bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
				<SelectValue placeholder='Select column' />
			</SelectTrigger>
			<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
				{items.map((column) => (
					<SelectItem key={column} value={column}>
						{column}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

interface ClearableInputProps {
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
	placeholder: string;
	ariaLabel: string;
	className?: string;
}

function ClearableInput({ value, onChange, onClear, placeholder, ariaLabel, className }: ClearableInputProps) {
	return (
		<div className='relative'>
			<Input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className={cn(className, 'pr-7')}
			/>
			{value && (
				<button
					type='button'
					aria-label={`Clear ${ariaLabel}`}
					onClick={onClear}
					className='absolute inset-y-0 right-1.5 flex items-center text-muted-foreground hover:text-foreground'
				>
					<X className='size-3.5' />
				</button>
			)}
		</div>
	);
}

interface AxisFieldsProps {
	name: string;
	showRange: boolean;
	labelPlaceholder: string;
	labelValue: string;
	onLabelChange: (value: string) => void;
	minId: string;
	maxId: string;
	minValue: string;
	maxValue: string;
	onMinChange: (value: string) => void;
	onMaxChange: (value: string) => void;
}

/** One axis on a single row: label field with its min/max fields underneath their headers. */
function AxisFields({
	name,
	showRange,
	labelPlaceholder,
	labelValue,
	onLabelChange,
	minId,
	maxId,
	minValue,
	maxValue,
	onMinChange,
	onMaxChange,
}: AxisFieldsProps) {
	return (
		<div className={`grid gap-3 items-end ${showRange ? 'grid-cols-[2fr_1fr_1fr]' : 'grid-cols-1'}`}>
			<div className='grid gap-1'>
				<span className='text-xs text-muted-foreground'>{name}</span>
				<Input
					className='h-8 bg-panel'
					placeholder={labelPlaceholder}
					value={labelValue}
					onChange={(e) => onLabelChange(e.target.value)}
				/>
			</div>
			{showRange && (
				<MinMaxFields
					minId={minId}
					maxId={maxId}
					minValue={minValue}
					maxValue={maxValue}
					onMinChange={onMinChange}
					onMaxChange={onMaxChange}
				/>
			)}
		</div>
	);
}

interface MinMaxFieldsProps {
	minId: string;
	maxId: string;
	minValue: string;
	maxValue: string;
	onMinChange: (value: string) => void;
	onMaxChange: (value: string) => void;
}

function MinMaxFields({ minId, maxId, minValue, maxValue, onMinChange, onMaxChange }: MinMaxFieldsProps) {
	return (
		<>
			<div className='grid gap-1'>
				<label htmlFor={minId} className='text-xs text-muted-foreground'>
					Min
				</label>
				<Input
					id={minId}
					className='h-8 bg-panel'
					type='text'
					inputMode='decimal'
					placeholder='Auto'
					value={minValue}
					onChange={(e) => onMinChange(e.target.value)}
				/>
			</div>
			<div className='grid gap-1'>
				<label htmlFor={maxId} className='text-xs text-muted-foreground'>
					Max
				</label>
				<Input
					id={maxId}
					className='h-8 bg-panel'
					type='text'
					inputMode='decimal'
					placeholder='Auto'
					value={maxValue}
					onChange={(e) => onMaxChange(e.target.value)}
				/>
			</div>
		</>
	);
}

interface SeriesTypeSelectProps {
	value: displayChart.SeriesType;
	onChange: (value: displayChart.SeriesType) => void;
}

function SeriesTypeSelect({ value, onChange }: SeriesTypeSelectProps) {
	return (
		<Select value={value} onValueChange={(next) => onChange(next as displayChart.SeriesType)}>
			<SelectTrigger variant='ghost' size='sm' className='h-auto gap-1 px-1 py-0 text-xs [&_svg]:size-3.5'>
				<SelectValue />
			</SelectTrigger>
			<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
				{SERIES_TYPE_OPTIONS.map(({ value: optionValue, label, icon: Icon }) => (
					<SelectItem key={optionValue} value={optionValue}>
						<Icon strokeWidth={1.5} />
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

interface SeriesValueFormatFieldsProps {
	d3Format: string;
	unit: string;
	placement: UnitPlacement;
	onD3FormatChange: (value: string) => void;
	onUnitChange: (unit: string, placement: UnitPlacement) => void;
}

function SeriesValueFormatFields({
	d3Format,
	unit,
	placement,
	onD3FormatChange,
	onUnitChange,
}: SeriesValueFormatFieldsProps) {
	return (
		<div className='grid grid-cols-[1fr_1fr_8rem] gap-2'>
			<div className='grid gap-1'>
				<div className='flex items-center gap-2'>
					<span className='text-xs text-muted-foreground'>Number format</span>
					<a
						href='https://docs.getnao.io/nao-agent/chat/capabilities/visualizations#d3-format-number-cheat-sheet'
						target='_blank'
						rel='noreferrer'
						className='text-xs text-blue-500 hover:text-blue-400 hover:underline'
					>
						How to format
					</a>
				</div>
				<ClearableInput
					value={d3Format}
					onChange={onD3FormatChange}
					onClear={() => onD3FormatChange('')}
					placeholder='e.g. ,.2f'
					ariaLabel='d3-format specifier'
					className='h-8 rounded-lg text-sm bg-panel'
				/>
			</div>
			<div className='grid gap-1'>
				<span className='text-xs text-muted-foreground'>Unit</span>
				<ClearableInput
					value={unit}
					onChange={(value) => onUnitChange(value, placement)}
					onClear={() => onUnitChange('', placement)}
					placeholder='$ or %'
					ariaLabel='Value unit'
					className='h-8 rounded-lg text-sm bg-panel'
				/>
			</div>
			<div className='grid gap-1'>
				<span className='text-xs text-muted-foreground'>Placement</span>
				<Select
					value={placement}
					disabled={!unit}
					onValueChange={(value) => onUnitChange(unit, value as UnitPlacement)}
				>
					<SelectTrigger
						aria-label='Unit placement'
						className='h-8 w-full bg-panel text-sm disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:text-foreground! [&_svg]:opacity-100!'
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className='bg-panel'>
						<SelectItem value='prefix'>Prefix</SelectItem>
						<SelectItem value='suffix'>Suffix</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

interface ValueFormatToggleProps {
	unit: string;
	open: boolean;
	onClick: () => void;
}

function ValueFormatToggle({ unit, open, onClick }: ValueFormatToggleProps) {
	return (
		<Button
			type='button'
			variant='outline'
			size='icon-sm'
			className='size-8 overflow-hidden bg-panel'
			aria-label='Value formatting'
			aria-expanded={open}
			title={unit || 'Value formatting'}
			onClick={onClick}
		>
			{unit ? (
				<span className='max-w-full truncate px-0.5 text-xs font-semibold'>{unit}</span>
			) : (
				<span className='max-w-full truncate px-0.5 text-xs font-semibold text-muted-foreground'>$</span>
			)}
		</Button>
	);
}

interface YAxisSideToggleProps {
	value: displayChart.YAxisSide;
	onChange: (value: displayChart.YAxisSide) => void;
}

function YAxisSideToggle({ value, onChange }: YAxisSideToggleProps) {
	const isRight = value === 'right';
	const Icon = isRight ? ChartBar : ChartColumn;
	const [open, setOpen] = useState(false);
	return (
		<Tooltip open={open} onOpenChange={setOpen} delayDuration={0}>
			<TooltipTrigger asChild>
				<Button
					type='button'
					variant='outline'
					size='icon-sm'
					className='size-8 bg-panel'
					aria-label={isRight ? 'Right Y-axis' : 'Left Y-axis'}
					onClick={() => {
						onChange(isRight ? 'left' : 'right');
						setOpen(true);
					}}
				>
					<Icon className={`size-4 transition-transform ${isRight ? '-rotate-90' : ''}`} />
				</Button>
			</TooltipTrigger>
			<TooltipContent side='top'>{isRight ? 'Right Y-axis' : 'Left Y-axis'}</TooltipContent>
		</Tooltip>
	);
}

function getSelectableColumns(columns: string[]): string[] {
	return Array.from(new Set(columns.filter((column) => column.length > 0)));
}

/**
 * Whether a comparison pill can actually render for the current data: the last two rows must
 * yield two valid numeric values for at least one series. Checked in 'absolute' mode so the gate
 * stays mode-agnostic (the user still picks percentage/variation/absolute in the selector).
 */
function hasRenderableKpiComparison(
	data: Record<string, unknown>[] | undefined,
	xAxisKey: string | undefined,
	series: displayChart.ChartInput['series'],
): boolean {
	if (!data || data.length < 2 || !series) {
		return false;
	}
	return series.some((s) => computeKpiComparison(data, xAxisKey ?? '', s.data_key, 'absolute') != null);
}

function toRangeString(n: number | undefined): string {
	return n === undefined ? '' : String(n);
}

function parseRangeInput(value: string): number | undefined {
	if (value.trim() === '') {
		return undefined;
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function cleanValueFormat(
	valueFormat: NonNullable<displayChart.SeriesConfig['value_format']>,
): displayChart.SeriesConfig['value_format'] {
	return valueFormat.d3_format || valueFormat.prefix || valueFormat.suffix ? valueFormat : undefined;
}

const UNSUPPORTED_NUMBER_FORMAT_MESSAGE =
	'This number format renders differently in story exports. Use formats like ,.2f, .2f, , or .2s.';

/**
 * Number formats that render identically in the interactive chart (d3-format) and in the
 * static story export formatter. Exposing only these in the editor keeps both paths consistent.
 */
const EXPORT_SAFE_NUMBER_FORMATS = [/^(,)?(?:\.\d+)?f$/, /^,$/, /^(?:\.\d+)?~?s$/];

function isExportSafeNumberFormat(format: string): boolean {
	return format === '' || EXPORT_SAFE_NUMBER_FORMATS.some((pattern) => pattern.test(format));
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function normalizeHexColor(color: string | undefined, fallback: string): string {
	if (color && HEX_RE.test(color)) {
		return color;
	}
	return HEX_RE.test(fallback) ? fallback : DEFAULT_COLORS[0];
}

function resolveChartPaletteHexes(): string[] {
	if (typeof document === 'undefined') {
		return DEFAULT_COLORS;
	}
	const context = document.createElement('canvas').getContext('2d');
	const rootStyle = getComputedStyle(document.documentElement);
	return DEFAULT_COLORS.map((fallback, index) => {
		const value = rootStyle.getPropertyValue(`--chart-${index + 1}`).trim();
		if (!value || !context) {
			return fallback;
		}
		return cssColorToHex(context, value) ?? fallback;
	});
}

function cssColorToHex(context: CanvasRenderingContext2D, color: string): string | null {
	const sentinel = '#010203';
	context.fillStyle = sentinel;
	context.fillStyle = color;
	if (context.fillStyle === sentinel && color.toLowerCase() !== sentinel) {
		return null;
	}
	context.fillRect(0, 0, 1, 1);
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function applyChartConfigToMessages(
	messages: UIMessage[],
	toolCallId: string,
	config: EditableChartInput,
): UIMessage[] {
	return messages.map((message) => {
		let changed = false;
		const parts = message.parts.map((part) => {
			if (part.type !== 'tool-display_chart') {
				return part;
			}
			const toolPart = part as UIToolPart<'display_chart'>;
			if (toolPart.toolCallId !== toolCallId) {
				return part;
			}
			changed = true;
			return { ...toolPart, input: config } as typeof part;
		});
		return changed ? { ...message, parts } : message;
	});
}
