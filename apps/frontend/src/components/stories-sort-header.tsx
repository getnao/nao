import { ChevronDown } from 'lucide-react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';
import type { SortDirection, SortField, SortState } from '@/lib/stories-page';
import { cn } from '@/lib/utils';

export function SortHeader({
	value,
	onChange,
	displayMode,
}: {
	value: SortState;
	onChange: (next: SortState) => void;
	displayMode: StoryPanelDisplayMode;
}) {
	if (displayMode === 'lines') {
		return (
			<div className='flex items-center gap-3 px-3 pb-2 mb-1'>
				<div className='flex-1 min-w-0 flex items-center'>
					<SortPill label='Name' field='name' value={value} onChange={onChange} />
				</div>
				<div className='hidden md:flex w-32 shrink-0 items-center'>
					<SortPill label='Owner' field='owner' value={value} onChange={onChange} />
				</div>
				<div className='hidden sm:flex w-24 shrink-0 items-center'>
					<SortPill label='Updated' field='updated' value={value} onChange={onChange} />
				</div>
				<div className='w-20 shrink-0' />
			</div>
		);
	}

	return (
		<div className='flex items-center gap-1'>
			<SortPill label='Name' field='name' value={value} onChange={onChange} />
			<SortPill label='Owner' field='owner' value={value} onChange={onChange} />
			<SortPill label='Updated' field='updated' value={value} onChange={onChange} />
		</div>
	);
}

function SortPill({
	label,
	field,
	value,
	onChange,
}: {
	label: string;
	field: SortField;
	value: SortState;
	onChange: (next: SortState) => void;
}) {
	const isActive = value.field === field;
	const direction: SortDirection = isActive ? value.direction : 'desc';

	function handleClick() {
		if (!isActive) {
			onChange({ field, direction: 'desc' });
		} else {
			onChange({ field, direction: value.direction === 'desc' ? 'asc' : 'desc' });
		}
	}

	return (
		<button
			type='button'
			onClick={handleClick}
			className={cn(
				'flex items-center gap-0.5 px-1.5 py-1 rounded text-xs transition-colors cursor-pointer select-none',
				isActive ? 'text-muted-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground/70',
			)}
		>
			<span>{label}</span>
			<ChevronDown
				size={12}
				className={cn('transition-transform', isActive && direction === 'asc' && 'rotate-180')}
			/>
		</button>
	);
}
