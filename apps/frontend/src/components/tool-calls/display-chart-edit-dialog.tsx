import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { displayChart } from '@nao/shared/tools';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { useAgentContext } from '@/contexts/agent.provider';
import { trpc } from '@/main';

const CHART_TYPE_OPTIONS: { value: displayChart.ChartType; label: string }[] = [
	{ value: 'bar', label: 'Bar' },
	{ value: 'stacked_bar', label: 'Stacked bar' },
	{ value: 'line', label: 'Line' },
	{ value: 'area', label: 'Area' },
	{ value: 'stacked_area', label: 'Stacked area' },
	{ value: 'pie', label: 'Pie' },
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

interface ChartConfigEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config: displayChart.Input;
	availableColumns: string[];
	onSave: (next: displayChart.Input) => Promise<void>;
	isSaving?: boolean;
	description?: string;
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
}: ChartConfigEditDialogProps) {
	const [draft, setDraft] = useState<displayChart.Input>(config);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(config);
			setError(null);
		}
	}, [open, config]);

	const xAxisOptions = useMemo(() => {
		if (availableColumns.length === 0) {
			return [config.x_axis_key];
		}
		return availableColumns;
	}, [availableColumns, config.x_axis_key]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const parsed = displayChart.InputSchema.safeParse(draft);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? 'Invalid chart configuration.');
			return;
		}

		try {
			await onSave(parsed.data);
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

	const removeSeriesAt = (index: number) => {
		setDraft((prev) => ({
			...prev,
			series: prev.series.length <= 1 ? prev.series : prev.series.filter((_, i) => i !== index),
		}));
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

					<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
						<div className='grid gap-2'>
							<span className='text-sm font-semibold text-foreground'>Chart type</span>
							<Select
								value={draft.chart_type}
								onValueChange={(value) =>
									setDraft((prev) => ({ ...prev, chart_type: value as displayChart.ChartType }))
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

						<div className='grid gap-2'>
							<span className='text-sm font-semibold text-foreground'>X-axis type</span>
							<Select
								value={draft.x_axis_type ?? 'auto'}
								onValueChange={(value) =>
									setDraft((prev) => ({
										...prev,
										x_axis_type: value === 'auto' ? null : (value as displayChart.XAxisType),
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

					<div className='grid gap-2'>
						<span className='text-sm font-semibold text-foreground'>X-axis column</span>
						<ColumnSelect
							value={draft.x_axis_key}
							columns={xAxisOptions}
							onChange={(value) => setDraft((prev) => ({ ...prev, x_axis_key: value }))}
						/>
					</div>

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
							{draft.series.map((series, index) => (
								<div
									key={index}
									className='grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center rounded-md'
								>
									<ColumnSelect
										value={series.data_key}
										columns={availableColumns.length > 0 ? availableColumns : [series.data_key]}
										onChange={(value) => updateSeriesAt(index, { data_key: value })}
									/>
									<Input
										value={series.label ?? ''}
										onChange={(e) => updateSeriesAt(index, { label: e.target.value || undefined })}
										placeholder='Label (optional)'
										className='h-8 rounded-lg text-sm bg-panel'
									/>
									<input
										type='color'
										aria-label='Series color'
										value={normalizeHexColor(series.color)}
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
							))}
						</div>
					</div>

					{error && <p className='text-xs text-destructive'>{error}</p>}

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
							disabled={isSaving}
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
	config: displayChart.Input;
	availableColumns: string[];
}

/** Edit dialog bound to a `tool-display_chart` message part: persists through `chart.updateConfig`. */
export function DisplayChartEditDialog({
	open,
	onOpenChange,
	toolCallId,
	config,
	availableColumns,
}: DisplayChartEditDialogProps) {
	const queryClient = useQueryClient();
	const { messages, setMessages } = useAgentContext();

	const updateMutation = useMutation(
		trpc.chart.updateConfig.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: [['chat', 'get']] });
			},
		}),
	);

	const handleSave = async (next: displayChart.Input) => {
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

function getSelectableColumns(columns: string[]): string[] {
	return Array.from(new Set(columns.filter((column) => column.length > 0)));
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function normalizeHexColor(color?: string): string {
	if (color && HEX_RE.test(color)) {
		return color;
	}
	return '#104e64';
}

function applyChartConfigToMessages(
	messages: UIMessage[],
	toolCallId: string,
	config: displayChart.Input,
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
