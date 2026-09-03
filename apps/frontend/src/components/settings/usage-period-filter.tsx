import { useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { MAX_USAGE_PERIOD_ENTRIES } from '@nao/backend/usage';
import type {
	Granularity,
	UsagePeriodEntry,
	UsagePeriodEntryInput,
	UsagePeriodMode,
	UsagePeriodPreference,
} from '@nao/backend/usage';
import { UsagePeriodEntryDialog } from '@/components/settings/usage-period-entry-dialog';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface UsagePeriodFilterProps {
	value: UsagePeriodPreference;
	entries: UsagePeriodEntry[];
	isLoading?: boolean;
	error?: string;
	onRetry?: () => void;
	onChange: (value: UsagePeriodPreference) => void | Promise<void>;
	onCreateEntry: (value: UsagePeriodEntryInput) => void | Promise<void>;
	onUpdateEntry: (value: UsagePeriodEntry) => void | Promise<void>;
	onDeleteEntry: (id: string) => void | Promise<void>;
}

const periodOptions: { value: Exclude<UsagePeriodMode, 'saved'>; label: string }[] = [
	{ value: '24h', label: 'Last 24 hours' },
	{ value: '15d', label: 'Last 15 days' },
	{ value: '6m', label: 'Last 6 months' },
];

const granularityLabels: Record<Granularity, string> = {
	hour: 'Hourly',
	day: 'Daily',
	month: 'Monthly',
};

export function UsagePeriodFilter({
	value,
	entries,
	isLoading = false,
	error,
	onRetry,
	onChange,
	onCreateEntry,
	onUpdateEntry,
	onDeleteEntry,
}: UsagePeriodFilterProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [editingEntry, setEditingEntry] = useState<UsagePeriodEntry>();
	const [isEntryDialogOpen, setIsEntryDialogOpen] = useState(false);
	const [entryToDelete, setEntryToDelete] = useState<UsagePeriodEntry>();
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string>();
	const deletingRef = useRef(false);
	const isEntryLimitReached = entries.length >= MAX_USAGE_PERIOD_ENTRIES;

	const openEntryDialog = (entry?: UsagePeriodEntry) => {
		setEditingEntry(entry);
		setIsOpen(false);
		setIsEntryDialogOpen(true);
	};

	const selectPeriod = async (preference: UsagePeriodPreference) => {
		setIsOpen(false);
		try {
			await onChange(preference);
		} catch {
			return;
		}
	};

	const deleteEntry = async () => {
		if (!entryToDelete || deletingRef.current) {
			return;
		}
		deletingRef.current = true;
		setIsDeleting(true);
		setDeleteError(undefined);
		try {
			await onDeleteEntry(entryToDelete.id);
			setEntryToDelete(undefined);
		} catch (cause) {
			setDeleteError(cause instanceof Error ? cause.message : 'Unable to delete this entry.');
		} finally {
			deletingRef.current = false;
			setIsDeleting(false);
		}
	};

	return (
		<>
			<Popover open={isOpen} onOpenChange={setIsOpen}>
				<PopoverTrigger asChild>
					<Button
						type='button'
						variant='outline'
						size='sm'
						className='h-8 w-40 justify-between px-2.5 font-normal'
						disabled={isLoading}
					>
						<span className='truncate'>
							{isLoading && value.mode === 'saved' ? 'Loading…' : formatPeriodPreference(value, entries)}
						</span>
						<ChevronDownIcon className='size-4 shrink-0 text-muted-foreground' />
					</Button>
				</PopoverTrigger>
				<PopoverContent align='start' className='w-64 p-1'>
					<div className='flex flex-col'>
						{periodOptions.map((option) => (
							<button
								key={option.value}
								type='button'
								className='flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground'
								onClick={() => void selectPeriod({ mode: option.value })}
							>
								<span className='flex size-4 items-center justify-center'>
									{value.mode === option.value && <CheckIcon className='size-4' />}
								</span>
								{option.label}
							</button>
						))}
						{entries.length > 0 && <div className='my-1 border-t' />}
						<div className='max-h-56 overflow-y-auto'>
							{entries.map((entry) => (
								<div key={entry.id} className='group flex h-8 items-center rounded-sm hover:bg-accent'>
									<button
										type='button'
										className='flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm'
										onClick={() => void selectPeriod({ mode: 'saved', entryId: entry.id })}
									>
										<span className='flex size-4 shrink-0 items-center justify-center'>
											{value.mode === 'saved' && value.entryId === entry.id && (
												<CheckIcon className='size-4' />
											)}
										</span>
										<span className='truncate'>{formatPeriodEntry(entry)}</span>
									</button>
									<button
										type='button'
										className='flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground'
										aria-label={`Edit ${formatPeriodEntry(entry)}`}
										onClick={() => openEntryDialog(entry)}
									>
										<PencilIcon className='size-3.5' />
									</button>
									<button
										type='button'
										className='flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive'
										aria-label={`Delete ${formatPeriodEntry(entry)}`}
										onClick={() => {
											setIsOpen(false);
											setDeleteError(undefined);
											setEntryToDelete(entry);
										}}
									>
										<Trash2Icon className='size-3.5' />
									</button>
								</div>
							))}
						</div>
						<div className='mt-1 border-t pt-1'>
							<button
								type='button'
								className='flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50'
								disabled={isEntryLimitReached}
								onClick={() => openEntryDialog()}
							>
								<PlusIcon className='size-4' />
								{isEntryLimitReached
									? `Entry limit reached (${MAX_USAGE_PERIOD_ENTRIES})`
									: 'Add entry'}
							</button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
			{error && (
				<span className='flex items-center gap-1 text-xs text-destructive' role='alert'>
					{error}
					{onRetry && (
						<button type='button' className='underline' onClick={onRetry}>
							Retry
						</button>
					)}
				</span>
			)}
			<UsagePeriodEntryDialog
				open={isEntryDialogOpen}
				onOpenChange={setIsEntryDialogOpen}
				entry={editingEntry}
				onSave={(entry) =>
					editingEntry ? onUpdateEntry({ ...entry, id: editingEntry.id }) : onCreateEntry(entry)
				}
			/>
			<ConfirmationDialog
				open={entryToDelete !== undefined}
				onOpenChange={(open) => {
					if (!open && !isDeleting) {
						setEntryToDelete(undefined);
						setDeleteError(undefined);
					}
				}}
				title='Delete usage period?'
				description={`“${entryToDelete ? formatPeriodEntry(entryToDelete) : ''}” will no longer be available in the period menu.`}
				confirmLabel='Delete'
				onConfirm={deleteEntry}
				isPending={isDeleting}
				error={deleteError}
				preventCloseWhilePending
			/>
		</>
	);
}

function formatPeriodPreference(preference: UsagePeriodPreference, entries: UsagePeriodEntry[]): string {
	if (preference.mode === 'saved') {
		const entry = entries.find(({ id }) => id === preference.entryId);
		return entry ? formatPeriodEntry(entry) : 'Last 15 days';
	}
	return periodOptions.find((option) => option.value === preference.mode)?.label ?? 'Period';
}

function formatPeriodEntry(entry: UsagePeriodEntry): string {
	return `${entry.days}d / ${granularityLabels[entry.granularity]}`;
}
