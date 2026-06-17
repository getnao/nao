import { ArchiveIcon, LayoutGrid, List, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function StoriesToolbarControls({
	searchQuery,
	onSearchQueryChange,
	displayMode,
	onDisplayModeChange,
	showArchived,
	onShowArchivedChange,
}: {
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	displayMode: StoryPanelDisplayMode;
	onDisplayModeChange: (value: StoryPanelDisplayMode) => void;
	showArchived: boolean;
	onShowArchivedChange: (value: boolean) => void;
}) {
	return (
		<div className='flex items-center gap-3'>
			{!showArchived && <SearchInput value={searchQuery} onChange={onSearchQueryChange} />}
			<Button
				variant='ghost'
				size='sm'
				onClick={() => onShowArchivedChange(!showArchived)}
				className='text-foreground gap-1.5 rounded-full border'
			>
				<ArchiveIcon className='size-4' />
				<span className='text-xs'>{showArchived ? 'Back to stories' : 'See archives'}</span>
			</Button>
			<DisplayModeToggle value={displayMode} onChange={onDisplayModeChange} />
		</div>
	);
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const [open, setOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			inputRef.current?.focus();
		}
	}, [open]);

	function handleClose() {
		setOpen(false);
		onChange('');
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Escape') {
			handleClose();
		}
	}

	if (!open) {
		return (
			<Button
				variant='ghost'
				size='icon-xs'
				className='rounded-full hover:rounded-full'
				onClick={() => setOpen(true)}
				aria-label='Search stories'
			>
				<Search className='size-4' />
			</Button>
		);
	}

	return (
		<div className='flex items-center gap-1.5 rounded-full border px-2 py-0.5 pt-1.5 pb-1.5'>
			<Search className='size-4 text-foreground shrink-0' />
			<input
				ref={inputRef}
				type='text'
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder='Search stories...'
				className='bg-transparent text-xs outline-none placeholder:text-muted-foreground w-40'
			/>
			<button type='button' onClick={handleClose} className='text-muted-foreground hover:text-foreground'>
				<X className='size-4' />
			</button>
		</div>
	);
}

function DisplayModeToggle({
	value,
	onChange,
}: {
	value: StoryPanelDisplayMode;
	onChange: (value: StoryPanelDisplayMode) => void;
}) {
	return (
		<div className='flex items-center gap-0.5 rounded-full border p-0.5'>
			<Button
				variant='ghost'
				size='icon-xs'
				onClick={() => onChange('grid')}
				className={cn(value === 'grid' && 'bg-accent rounded-full', 'hover:rounded-full')}
				aria-label='Grid view'
			>
				<LayoutGrid />
			</Button>
			<Button
				variant='ghost'
				size='icon-xs'
				onClick={() => onChange('lines')}
				className={cn(value === 'lines' && 'bg-accent rounded-full', 'hover:rounded-full')}
				aria-label='List view'
			>
				<List />
			</Button>
		</div>
	);
}
