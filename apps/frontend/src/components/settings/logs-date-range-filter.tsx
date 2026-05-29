import { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import { Calendar } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import 'react-datepicker/dist/react-datepicker.css';

export type LogsDateRange = {
	from?: Date;
	to?: Date;
};

type Preset = {
	id: string;
	label: string;
	minutes: number;
};

const PRESETS: Preset[] = [
	{ id: '15m', label: 'Last 15 minutes', minutes: 15 },
	{ id: '1h', label: 'Last hour', minutes: 60 },
	{ id: '24h', label: 'Last 24 hours', minutes: 60 * 24 },
	{ id: '7d', label: 'Last 7 days', minutes: 60 * 24 * 7 },
];

type LogsDateRangeFilterProps = {
	value: LogsDateRange | undefined;
	onChange: (value: LogsDateRange | undefined) => void;
};

function formatDateTime(d: Date): string {
	return d.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
}

function rangesEqual(a: LogsDateRange | undefined, b: LogsDateRange | undefined): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return a.from?.getTime() === b.from?.getTime() && a.to?.getTime() === b.to?.getTime();
}

export function LogsDateRangeFilter({ value, onChange }: LogsDateRangeFilterProps) {
	const [open, setOpen] = useState(false);
	const [customMode, setCustomMode] = useState(false);
	const [customStart, setCustomStart] = useState<Date | null>(value?.from ?? null);
	const [customEnd, setCustomEnd] = useState<Date | null>(value?.to ?? null);
	const prevValueRef = useRef<LogsDateRange | undefined>(value);

	useEffect(() => {
		const prev = prevValueRef.current;
		const sameFrom = prev?.from?.getTime() === value?.from?.getTime();
		const sameTo = prev?.to?.getTime() === value?.to?.getTime();
		prevValueRef.current = value;
		if (sameFrom && sameTo) {
			return;
		}
		setCustomStart(value?.from ?? null);
		setCustomEnd(value?.to ?? null);
	}, [value]);

	const activePresetId = useMemo(() => {
		if (!value?.from || value.to) {
			return null;
		}
		const diffMs = Date.now() - value.from.getTime();
		const preset = PRESETS.find((p) => Math.abs(diffMs - p.minutes * 60 * 1000) < 30 * 1000);
		return preset?.id ?? null;
	}, [value]);

	const hasActiveFilter = Boolean(value?.from || value?.to);

	const label = (() => {
		if (!hasActiveFilter || !value) {
			return 'All time';
		}
		if (activePresetId) {
			return PRESETS.find((p) => p.id === activePresetId)?.label ?? 'Custom';
		}
		const fromStr = value.from ? formatDateTime(value.from) : '…';
		const toStr = value.to ? formatDateTime(value.to) : 'now';
		return `${fromStr} → ${toStr}`;
	})();

	const applyPreset = (preset: Preset) => {
		const from = new Date(Date.now() - preset.minutes * 60 * 1000);
		const next: LogsDateRange = { from };
		if (!rangesEqual(value, next)) {
			onChange(next);
		}
		setCustomMode(false);
		setOpen(false);
	};

	const clearFilter = () => {
		setCustomStart(null);
		setCustomEnd(null);
		setCustomMode(false);
		onChange(undefined);
		setOpen(false);
	};

	const applyCustom = (start: Date | null, end: Date | null) => {
		setCustomStart(start);
		setCustomEnd(end);
		if (start && end) {
			onChange({ from: start, to: end });
		} else if (!start && !end) {
			onChange(undefined);
		}
	};

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm' className={cn(hasActiveFilter && 'text-primary')}>
					<Calendar className='size-3.5' />
					<span className='truncate max-w-[220px]'>{label}</span>
					{hasActiveFilter && (
						<Badge variant='secondary' className='ml-1 h-4 px-1 text-[10px]'>
							1
						</Badge>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-auto p-0'>
				<div className='px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border'>
					Time range
				</div>
				{!customMode ? (
					<div className='flex flex-col py-1 min-w-[200px]'>
						{PRESETS.map((preset) => (
							<button
								key={preset.id}
								type='button'
								onClick={() => applyPreset(preset)}
								className={cn(
									'flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground',
									activePresetId === preset.id && 'text-primary',
								)}
							>
								{preset.label}
							</button>
						))}
						<button
							type='button'
							onClick={() => setCustomMode(true)}
							className='flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground'
						>
							Custom range…
						</button>
					</div>
				) : (
					<div className='p-2'>
						<DatePicker
							selected={customStart}
							startDate={customStart ?? undefined}
							endDate={customEnd ?? undefined}
							selectsRange
							showTimeSelect
							timeIntervals={15}
							dateFormat='MMM d, HH:mm'
							onChange={(range: [Date | null, Date | null]) => {
								const [start, end] = range ?? [null, null];
								applyCustom(start, end);
							}}
							inline
							popperProps={{ strategy: 'fixed' }}
							calendarClassName='react-datepicker--no-shadow chats-replay-datepicker'
						/>
					</div>
				)}
				<div className='flex items-center justify-between gap-2 border-t border-border px-2 py-2'>
					<button
						type='button'
						onClick={() => setCustomMode((m) => !m)}
						className='text-xs text-muted-foreground hover:text-foreground'
					>
						{customMode ? 'Back to presets' : 'Custom range'}
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
