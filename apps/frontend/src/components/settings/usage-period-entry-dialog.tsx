import { useEffect, useRef, useState } from 'react';
import {
	getUsageChartBucketCount,
	MAX_USAGE_CHART_BUCKETS_PER_REQUEST,
	USAGE_CHART_BUCKET_LIMIT_MESSAGE,
} from '@nao/backend/usage';
import type { Granularity, UsagePeriodEntry, UsagePeriodEntryInput } from '@nao/backend/usage';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface UsagePeriodEntryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entry?: UsagePeriodEntry;
	onSave: (value: UsagePeriodEntryInput) => void | Promise<void>;
}

export function UsagePeriodEntryDialog({ open, onOpenChange, entry, onSave }: UsagePeriodEntryDialogProps) {
	const [days, setDays] = useState('30');
	const [granularity, setGranularity] = useState<Granularity>('day');
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string>();
	const savingRef = useRef(false);
	const parsedDays = Number(days);
	const hasValidDays = Number.isInteger(parsedDays) && parsedDays > 0;
	const bucketCount = hasValidDays ? getUsageChartBucketCount({ value: parsedDays, unit: 'day' }, granularity) : 0;
	const exceedsBucketLimit = bucketCount > MAX_USAGE_CHART_BUCKETS_PER_REQUEST;
	const suggestedGranularity = hasValidDays ? getSuggestedGranularity(parsedDays, granularity) : undefined;
	const isValid = hasValidDays && !exceedsBucketLimit;
	const validationMessage = exceedsBucketLimit
		? `${USAGE_CHART_BUCKET_LIMIT_MESSAGE} ${
				suggestedGranularity
					? `Use ${granularityLabels[suggestedGranularity].toLowerCase()} grouping for this range.`
					: 'Reduce the number of days.'
			}`
		: undefined;

	useEffect(() => {
		if (!open) {
			return;
		}
		setDays(String(entry?.days ?? 30));
		setGranularity(entry?.granularity ?? 'day');
		setError(undefined);
	}, [entry, open]);

	const save = async () => {
		if (!isValid || savingRef.current) {
			return;
		}
		savingRef.current = true;
		setIsPending(true);
		setError(undefined);
		try {
			await onSave({ days: parsedDays, granularity });
			onOpenChange(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Unable to save this entry.');
		} finally {
			savingRef.current = false;
			setIsPending(false);
		}
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && isPending) {
			return;
		}
		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>{entry ? 'Edit period filter' : 'Create period filter'}</DialogTitle>
					<DialogDescription>Choose the date range and grouping used by the usage charts.</DialogDescription>
				</DialogHeader>
				<form
					className='grid gap-4'
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<div className='grid grid-cols-2 gap-3'>
						<div className='grid gap-2'>
							<label htmlFor='usage-period-entry-days' className='text-sm font-medium'>
								Days
							</label>
							<Input
								id='usage-period-entry-days'
								type='number'
								min={1}
								step={1}
								value={days}
								onChange={(event) => setDays(event.target.value)}
								aria-invalid={!hasValidDays || exceedsBucketLimit}
								aria-describedby={validationMessage ? 'usage-period-entry-validation' : undefined}
								autoFocus
							/>
						</div>
						<div className='grid gap-2'>
							<label htmlFor='usage-period-entry-granularity' className='text-sm font-medium'>
								Granularity
							</label>
							<Select value={granularity} onValueChange={(value) => setGranularity(value as Granularity)}>
								<SelectTrigger
									id='usage-period-entry-granularity'
									size='input'
									aria-invalid={exceedsBucketLimit}
									aria-describedby={validationMessage ? 'usage-period-entry-validation' : undefined}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='hour'>Hourly</SelectItem>
									<SelectItem value='day'>Daily</SelectItem>
									<SelectItem value='month'>Monthly</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					{validationMessage && (
						<p id='usage-period-entry-validation' className='text-sm text-destructive'>
							{validationMessage}
						</p>
					)}
					{error && (
						<p className='text-sm text-destructive' role='alert'>
							{error}
						</p>
					)}
					<div className='flex justify-end gap-2'>
						<Button
							type='button'
							variant='ghost'
							size='sm'
							disabled={isPending}
							onClick={() => handleOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type='submit' size='sm' disabled={!isValid || isPending} isLoading={isPending}>
							{entry ? 'Save' : 'Create'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

const granularityLabels: Record<Granularity, string> = {
	hour: 'Hourly',
	day: 'Daily',
	month: 'Monthly',
};

const granularities: Granularity[] = ['hour', 'day', 'month'];

function getSuggestedGranularity(days: number, current: Granularity): Granularity | undefined {
	return granularities
		.slice(granularities.indexOf(current) + 1)
		.find(
			(granularity) =>
				getUsageChartBucketCount({ value: days, unit: 'day' }, granularity) <=
				MAX_USAGE_CHART_BUCKETS_PER_REQUEST,
		);
}
