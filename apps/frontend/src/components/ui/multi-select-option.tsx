import { Check } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { CommandItem } from '@/components/ui/command';
import { cn } from '@/lib/utils';

export function MultiSelectActions({
	onSelectAll,
	onDeselectAll,
	canSelectAll = true,
}: {
	onSelectAll: () => void;
	onDeselectAll: () => void;
	canSelectAll?: boolean;
}) {
	return (
		<div className='flex items-center justify-between px-3 pt-2 pb-1'>
			<SelectionActionButton label='Select all' disabled={!canSelectAll} onClick={onSelectAll} />
			<SelectionActionButton label='Deselect all' onClick={onDeselectAll} />
		</div>
	);
}

/** A command list row with a check mark, and an "Only" shortcut on hover when `onSelectOnly` is set. */
export function MultiSelectOption({
	value,
	label,
	count,
	isSelected,
	onToggle,
	onSelectOnly,
}: {
	value: string;
	label: string;
	count?: number;
	isSelected: boolean;
	onToggle: () => void;
	onSelectOnly?: () => void;
}) {
	const handleSelectOnly = (event: MouseEvent) => {
		event.stopPropagation();
		onSelectOnly?.();
	};

	return (
		<CommandItem value={value} aria-label={label} onSelect={onToggle} className='group cursor-pointer'>
			<span className='flex-1 truncate'>{label}</span>
			{onSelectOnly && (
				<button
					type='button'
					tabIndex={-1}
					aria-label={`Only ${label}`}
					onClick={handleSelectOnly}
					className='shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100 hover:text-foreground hover:underline'
				>
					Only
				</button>
			)}
			{typeof count === 'number' && (
				<Badge variant='secondary' className='h-4 px-1 text-xs'>
					{count}
				</Badge>
			)}
			<Check className={cn('size-3.5', !isSelected && 'opacity-0')} />
		</CommandItem>
	);
}

function SelectionActionButton({
	label,
	disabled,
	onClick,
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			disabled={disabled}
			onClick={onClick}
			className='cursor-pointer text-xs text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:text-muted-foreground'
		>
			{label}
		</button>
	);
}
