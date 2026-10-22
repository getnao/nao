import { ArrowRight, CalendarIcon, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { isSameDay, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';

import type { DateRangeField, DateRangePreset, DateRangeSelection } from '@/lib/date-range';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
	DATE_RANGE_PRESETS,
	countRangeDays,
	findMatchingPreset,
	formatRangeDate,
	formatShortRange,
	getInitialMonth,
	getPreviewRange,
	selectDay,
} from '@/lib/date-range';
import { cn } from '@/lib/utils';

const TODAY_CLASS_NAME =
	'[&>button]:font-semibold [&>button]:text-primary [&>button]:underline [&>button]:underline-offset-4 [&>button[data-range-end=true]]:text-primary-foreground [&>button[data-range-start=true]]:text-primary-foreground';

export function DateRangePicker({
	value,
	onChange,
	placeholder = 'Select a date range',
	className,
}: {
	value: DateRange | undefined;
	onChange: (range: DateRange | undefined) => void;
	placeholder?: string;
	className?: string;
}) {
	const isMobile = useIsMobile();
	const numberOfMonths = isMobile ? 1 : 2;
	const [isOpen, setIsOpen] = useState(false);
	const [selection, setSelection] = useState<DateRangeSelection>(() => initialSelection(value));
	const [month, setMonth] = useState<Date>(() => getInitialMonth(value, numberOfMonths));
	const [hoveredDay, setHoveredDay] = useState<Date | undefined>();

	const handleOpenChange = (open: boolean) => {
		if (open) {
			setSelection(initialSelection(value));
			setMonth(getInitialMonth(value, numberOfMonths));
			setHoveredDay(undefined);
		}
		setIsOpen(open);
	};

	const handlePresetSelect = (preset: DateRangePreset) => {
		const range = preset.getRange(startOfDay(new Date()));
		setSelection({ range, activeField: null, presetId: preset.id });
		setMonth(getInitialMonth(range, numberOfMonths));
	};

	const handleFieldFocus = (field: DateRangeField) => {
		if (field === 'end' && !selection.range?.from) {
			return;
		}
		setSelection((current) => ({ ...current, activeField: field }));
	};

	const handleDayHover = (day: Date) => {
		if (selection.activeField !== 'end') {
			return;
		}
		setHoveredDay((current) => (current && isSameDay(current, day) ? current : day));
	};

	const handleApply = () => {
		onChange(selection.range);
		setIsOpen(false);
	};

	const draftRange = selection.range;
	const isDraftComplete = Boolean(draftRange?.from && draftRange.to);
	const previewRange = getPreviewRange(selection, hoveredDay);

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant='outline'
					size='sm'
					className={cn('h-8 min-w-56 justify-start bg-background font-normal', className)}
				>
					<CalendarIcon className='size-3.5 text-muted-foreground' />
					<DateRangeTriggerLabel value={value} placeholder={placeholder} />
					<ChevronDown className='ml-auto size-3.5 text-muted-foreground' />
				</Button>
			</PopoverTrigger>
			<PopoverContent className='w-auto overflow-hidden p-0' align='start'>
				<div className='flex flex-col md:flex-row'>
					<DateRangePresetList selection={selection} onSelect={handlePresetSelect} />
					<div className='flex flex-col'>
						<DateRangeFields
							range={draftRange}
							activeField={selection.activeField}
							onFieldFocus={handleFieldFocus}
						/>
						<Calendar
							mode='range'
							selected={draftRange}
							onSelect={(_range, day) => setSelection((current) => selectDay(current, day))}
							onDayMouseEnter={handleDayHover}
							onDayMouseLeave={() => setHoveredDay(undefined)}
							month={month}
							onMonthChange={setMonth}
							numberOfMonths={numberOfMonths}
							showOutsideDays={false}
							classNames={{ today: TODAY_CLASS_NAME }}
							modifiers={{ preview: previewRange ?? [] }}
							modifiersClassNames={{ preview: 'bg-accent/70 [&>button]:rounded-none' }}
						/>
					</div>
				</div>
				<div className='flex items-center justify-between gap-6 border-t px-4 py-3'>
					<DateRangeHint selection={selection} />
					<div className='flex items-center gap-2'>
						<Button variant='ghost' size='sm' className='h-8' onClick={() => setIsOpen(false)}>
							Cancel
						</Button>
						<Button size='sm' className='h-8 px-4' disabled={!isDraftComplete} onClick={handleApply}>
							Apply
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function DateRangeTriggerLabel({ value, placeholder }: { value: DateRange | undefined; placeholder: string }) {
	if (!value?.from || !value.to) {
		return <span className='text-muted-foreground'>{placeholder}</span>;
	}

	const preset = findMatchingPreset(value);
	if (!preset) {
		return <span>{formatShortRange(value)}</span>;
	}

	return (
		<span className='flex items-center gap-1.5'>
			<span className='font-medium'>{preset.label}</span>
			<span className='text-muted-foreground'>{formatShortRange(value)}</span>
		</span>
	);
}

function DateRangePresetList({
	selection,
	onSelect,
}: {
	selection: DateRangeSelection;
	onSelect: (preset: DateRangePreset) => void;
}) {
	const selectedPresetId = selection.presetId ?? findMatchingPreset(selection.range)?.id;

	return (
		<div className='grid grid-cols-2 gap-0.5 border-b bg-muted/30 p-2 md:flex md:w-44 md:flex-col md:border-r md:border-b-0'>
			<span className='col-span-2 px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase'>
				Quick select
			</span>
			{DATE_RANGE_PRESETS.map((preset) => {
				const isSelected = selectedPresetId === preset.id;
				return (
					<button
						key={preset.id}
						type='button'
						onClick={() => onSelect(preset)}
						className={cn(
							'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
							isSelected && 'bg-accent font-medium text-foreground',
						)}
					>
						{preset.label}
						{isSelected && <Check className='size-3.5 text-primary' />}
					</button>
				);
			})}
		</div>
	);
}

function DateRangeFields({
	range,
	activeField,
	onFieldFocus,
}: {
	range: DateRange | undefined;
	activeField: DateRangeField | null;
	onFieldFocus: (field: DateRangeField) => void;
}) {
	return (
		<div className='flex items-end gap-2 border-b px-3 pt-3 pb-3'>
			<DateRangeFieldButton
				label='Start date'
				date={range?.from}
				isActive={activeField === 'start'}
				onClick={() => onFieldFocus('start')}
			/>
			<ArrowRight className='mb-2.5 size-4 shrink-0 text-muted-foreground' />
			<DateRangeFieldButton
				label='End date'
				date={range?.to}
				isActive={activeField === 'end'}
				isDisabled={!range?.from}
				onClick={() => onFieldFocus('end')}
			/>
		</div>
	);
}

function DateRangeFieldButton({
	label,
	date,
	isActive,
	isDisabled = false,
	onClick,
}: {
	label: string;
	date: Date | undefined;
	isActive: boolean;
	isDisabled?: boolean;
	onClick: () => void;
}) {
	const dateLabel = date ? formatRangeDate(date) : 'Select date';

	return (
		<div className='flex flex-1 flex-col gap-1'>
			<span className='text-xs font-medium text-muted-foreground'>{label}</span>
			<button
				type='button'
				disabled={isDisabled}
				onClick={onClick}
				aria-label={`${label}: ${dateLabel}`}
				aria-pressed={isActive}
				className={cn(
					'flex h-9 items-center rounded-md border bg-background px-3 text-left text-sm transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border',
					isActive && 'border-primary ring-[3px] ring-primary/15 hover:border-primary',
					!date && 'text-muted-foreground',
				)}
			>
				{dateLabel}
			</button>
		</div>
	);
}

function DateRangeHint({ selection }: { selection: DateRangeSelection }) {
	const { range, activeField } = selection;
	const dayCount = countRangeDays(range);

	if (activeField === 'start') {
		return <DateRangeStep step={1} message='Click a day to set the start date' />;
	}
	if (activeField === 'end') {
		return <DateRangeStep step={2} message='Now click a day to set the end date' />;
	}
	return (
		<span className='text-xs text-muted-foreground'>
			<span className='font-medium text-foreground'>
				{dayCount} {dayCount === 1 ? 'day' : 'days'}
			</span>{' '}
			selected · click a day to start over
		</span>
	);
}

function DateRangeStep({ step, message }: { step: 1 | 2; message: string }) {
	return (
		<span className='flex items-center gap-2 text-xs text-muted-foreground'>
			<span className='flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary'>
				{step}
			</span>
			{message}
		</span>
	);
}

function initialSelection(value: DateRange | undefined): DateRangeSelection {
	const isComplete = Boolean(value?.from && value.to);
	return { range: value, activeField: isComplete ? null : 'start' };
}
