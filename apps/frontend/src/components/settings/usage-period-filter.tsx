import { useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { MAX_SAVED_USAGE_PERIODS } from '@nao/backend/usage';
import type {
	Granularity,
	SavedUsagePeriod,
	SavedUsagePeriodInput,
	UsagePeriodMode,
	UsagePeriodSelection,
} from '@nao/backend/usage';
import { SavedUsagePeriodDialog } from '@/components/settings/saved-usage-period-dialog';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface UsagePeriodFilterProps {
	value: UsagePeriodSelection;
	savedPeriods: SavedUsagePeriod[];
	isLoading?: boolean;
	error?: string;
	onRetry?: () => void;
	onChange: (value: UsagePeriodSelection) => void | Promise<void>;
	onCreateSavedPeriod: (value: SavedUsagePeriodInput) => void | Promise<void>;
	onUpdateSavedPeriod: (value: SavedUsagePeriod) => void | Promise<void>;
	onDeleteSavedPeriod: (id: string) => void | Promise<void>;
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
	savedPeriods,
	isLoading = false,
	error,
	onRetry,
	onChange,
	onCreateSavedPeriod,
	onUpdateSavedPeriod,
	onDeleteSavedPeriod,
}: UsagePeriodFilterProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [editingSavedPeriod, setEditingSavedPeriod] = useState<SavedUsagePeriod>();
	const [isSavedPeriodDialogOpen, setIsSavedPeriodDialogOpen] = useState(false);
	const [savedPeriodToDelete, setSavedPeriodToDelete] = useState<SavedUsagePeriod>();
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string>();
	const deletingRef = useRef(false);
	const isSavedPeriodLimitReached = savedPeriods.length >= MAX_SAVED_USAGE_PERIODS;

	const openSavedPeriodDialog = (savedPeriod?: SavedUsagePeriod) => {
		setEditingSavedPeriod(savedPeriod);
		setIsOpen(false);
		setIsSavedPeriodDialogOpen(true);
	};

	const selectPeriod = async (selection: UsagePeriodSelection) => {
		setIsOpen(false);
		try {
			await onChange(selection);
		} catch {
			return;
		}
	};

	const deleteSavedPeriod = async () => {
		if (!savedPeriodToDelete || deletingRef.current) {
			return;
		}
		deletingRef.current = true;
		setIsDeleting(true);
		setDeleteError(undefined);
		try {
			await onDeleteSavedPeriod(savedPeriodToDelete.id);
			setSavedPeriodToDelete(undefined);
		} catch (cause) {
			setDeleteError(cause instanceof Error ? cause.message : 'Unable to delete this period.');
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
						className='h-8 min-w-40 justify-between px-2.5 font-normal'
						disabled={isLoading}
					>
						<span>
							{isLoading && value.mode === 'saved'
								? 'Loading…'
								: formatPeriodSelection(value, savedPeriods)}
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
								className='flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground'
								onClick={() => void selectPeriod({ mode: option.value })}
							>
								<span className='flex size-4 items-center justify-center'>
									{value.mode === option.value && <CheckIcon className='size-4' />}
								</span>
								{option.label}
							</button>
						))}
						{savedPeriods.length > 0 && <div className='my-1 border-t' />}
						<div className='max-h-56 overflow-y-auto'>
							{savedPeriods.map((savedPeriod) => (
								<div
									key={savedPeriod.id}
									className='group flex h-8 items-center rounded-sm hover:bg-accent'
								>
									<button
										type='button'
										className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-left text-sm'
										onClick={() =>
											void selectPeriod({ mode: 'saved', savedPeriodId: savedPeriod.id })
										}
									>
										<span className='flex size-4 shrink-0 items-center justify-center'>
											{value.mode === 'saved' && value.savedPeriodId === savedPeriod.id && (
												<CheckIcon className='size-4' />
											)}
										</span>
										<span className='truncate'>{formatSavedPeriod(savedPeriod)}</span>
									</button>
									<button
										type='button'
										className='flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground'
										aria-label={`Edit ${formatSavedPeriod(savedPeriod)}`}
										onClick={() => openSavedPeriodDialog(savedPeriod)}
									>
										<PencilIcon className='size-3.5' />
									</button>
									<button
										type='button'
										className='flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-destructive'
										aria-label={`Delete ${formatSavedPeriod(savedPeriod)}`}
										onClick={() => {
											setIsOpen(false);
											setDeleteError(undefined);
											setSavedPeriodToDelete(savedPeriod);
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
								className='flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50'
								disabled={isSavedPeriodLimitReached}
								onClick={() => openSavedPeriodDialog()}
							>
								<PlusIcon className='size-4' />
								{isSavedPeriodLimitReached
									? `Saved period limit reached (${MAX_SAVED_USAGE_PERIODS})`
									: 'Create filter'}
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
			<SavedUsagePeriodDialog
				open={isSavedPeriodDialogOpen}
				onOpenChange={setIsSavedPeriodDialogOpen}
				savedPeriod={editingSavedPeriod}
				onSave={(savedPeriod) =>
					editingSavedPeriod
						? onUpdateSavedPeriod({ ...savedPeriod, id: editingSavedPeriod.id })
						: onCreateSavedPeriod(savedPeriod)
				}
			/>
			<ConfirmationDialog
				open={savedPeriodToDelete !== undefined}
				onOpenChange={(open) => {
					if (!open && !isDeleting) {
						setSavedPeriodToDelete(undefined);
						setDeleteError(undefined);
					}
				}}
				title='Remove filter?'
				description={`“${savedPeriodToDelete ? formatSavedPeriod(savedPeriodToDelete) : ''}” will no longer be available in the period menu.`}
				confirmLabel='Remove'
				onConfirm={deleteSavedPeriod}
				isPending={isDeleting}
				error={deleteError}
				preventCloseWhilePending
			/>
		</>
	);
}

function formatPeriodSelection(selection: UsagePeriodSelection, savedPeriods: SavedUsagePeriod[]): string {
	if (selection.mode === 'saved') {
		const savedPeriod = savedPeriods.find(({ id }) => id === selection.savedPeriodId);
		return savedPeriod ? formatSavedPeriod(savedPeriod) : 'Last 15 days';
	}
	return periodOptions.find((option) => option.value === selection.mode)?.label ?? 'Period';
}

function formatSavedPeriod(savedPeriod: SavedUsagePeriod): string {
	const dayLabel = savedPeriod.days === 1 ? 'day' : 'days';
	return `Last ${savedPeriod.days} ${dayLabel} - ${granularityLabels[savedPeriod.granularity]}`;
}
