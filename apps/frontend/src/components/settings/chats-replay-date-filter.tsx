import { useState } from 'react';
import DatePicker from 'react-datepicker';
import { Calendar } from 'lucide-react';

import type { UpdatedAtFilter } from '@nao/shared';
import { cn, toLocalDateString } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import 'react-datepicker/dist/react-datepicker.css';

type ChatsReplayDateFilterProps = {
	value: UpdatedAtFilter | undefined;
	onChange: (value: UpdatedAtFilter | undefined) => void;
};

export function ChatsReplayDateFilter({ value, onChange }: ChatsReplayDateFilterProps) {
	const [mode, setMode] = useState<'single' | 'range'>(value?.mode ?? 'single');
	const [singleDate, setSingleDate] = useState<Date | null>(
		value?.mode === 'single' && value.value ? new Date(value.value + 'T12:00:00') : null,
	);
	const [startDate, setStartDate] = useState<Date | null>(
		value?.mode === 'range' && value.start ? new Date(value.start + 'T12:00:00') : null,
	);
	const [endDate, setEndDate] = useState<Date | null>(
		value?.mode === 'range' && value.end ? new Date(value.end + 'T12:00:00') : null,
	);
	const [open, setOpen] = useState(false);

	const applyFilter = (
		single: Date | null,
		start: Date | null,
		end: Date | null,
		currentMode: 'single' | 'range',
	) => {
		if (currentMode === 'single') {
			if (single) {
				onChange({ mode: 'single', value: toLocalDateString(single) });
			} else {
				onChange(undefined);
			}
			return;
		}
		if (start && end) {
			onChange({ mode: 'range', start: toLocalDateString(start), end: toLocalDateString(end) });
		} else if (!start && !end) {
			onChange(undefined);
		}
	};

	const handleSingleChange = (date: Date | null) => {
		setSingleDate(date);
		applyFilter(date, null, null, 'single');
	};

	const handleModeToggle = () => {
		const nextMode = mode === 'single' ? 'range' : 'single';
		setMode(nextMode);
		if (nextMode === 'single') {
			applyFilter(singleDate, null, null, 'single');
		} else {
			applyFilter(null, startDate, endDate, 'range');
		}
	};

	const clearFilter = () => {
		setSingleDate(null);
		setStartDate(null);
		setEndDate(null);
		onChange(undefined);
		setOpen(false);
	};

	const hasActiveFilter =
		(value?.mode === 'single' && value.value) || (value?.mode === 'range' && value.start && value.end);

	const label =
		hasActiveFilter && value
			? value.mode === 'single'
				? value.value
				: `${value.start} – ${value.end}`
			: 'Last update';

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button variant='ghost' size='sm' className={cn(hasActiveFilter && 'text-primary')}>
					<Calendar className='size-4 mr-1' />
					{label}
					{hasActiveFilter && (
						<Badge variant='secondary' className='ml-1 h-4 px-1 text-xs'>
							1
						</Badge>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='w-auto p-0'>
				<div className='px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border'>
					Last update
				</div>
				<div className='p-2'>
					{mode === 'single' ? (
						<DatePicker
							selected={singleDate}
							onChange={handleSingleChange}
							inline
							popperProps={{ strategy: 'fixed' }}
							calendarClassName='react-datepicker--no-shadow chats-replay-datepicker'
						/>
					) : (
						<DatePicker
							selected={startDate}
							startDate={startDate ?? undefined}
							endDate={endDate ?? undefined}
							selectsRange
							onChange={(range: [Date | null, Date | null]) => {
								const [start, end] = range ?? [null, null];
								setStartDate(start);
								setEndDate(end);
								if (start && end) {
									applyFilter(null, start, end, 'range');
								} else if (!start && !end) {
									onChange(undefined);
								}
							}}
							inline
							popperProps={{ strategy: 'fixed' }}
							calendarClassName='react-datepicker--no-shadow chats-replay-datepicker'
						/>
					)}
				</div>
				<div className='flex items-center justify-between gap-2 border-t border-border px-2 py-2'>
					<button
						type='button'
						onClick={handleModeToggle}
						className='text-xs text-muted-foreground hover:text-foreground'
					>
						{mode === 'single' ? 'Switch to range' : 'Switch to single'}
					</button>
					<button
						type='button'
						className='text-right px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
						onClick={clearFilter}
					>
						Show all
					</button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
