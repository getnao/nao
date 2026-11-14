import { DynamicIcon, iconNames } from 'lucide-react/dynamic';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

const MAX_VISIBLE_ICONS = 160;

export default function IconPickerGrid({
	query,
	selectedName,
	onSelect,
}: {
	query: string;
	selectedName: string | null;
	onSelect: (name: string) => void;
}) {
	const matchingNames = useMemo(() => filterIconNames(query), [query]);
	const visibleNames = matchingNames.slice(0, MAX_VISIBLE_ICONS);

	if (matchingNames.length === 0) {
		return <p className='py-6 text-center text-xs text-muted-foreground'>No icon matches “{query}”.</p>;
	}

	return (
		<div className='flex flex-col gap-2'>
			<div className='grid max-h-64 grid-cols-8 gap-1 overflow-y-auto'>
				{visibleNames.map((name) => (
					<button
						key={name}
						type='button'
						title={name}
						aria-label={name}
						aria-pressed={name === selectedName}
						onClick={() => onSelect(name)}
						className={cn(
							'flex size-8 items-center justify-center rounded-md hover:bg-accent cursor-pointer',
							name === selectedName && 'bg-accent ring-1 ring-primary',
						)}
					>
						<DynamicIcon
							name={name}
							className='size-4'
							fallback={() => <span aria-hidden className='size-4' />}
						/>
					</button>
				))}
			</div>
			<p className='text-[11px] text-muted-foreground'>
				{matchingNames.length > MAX_VISIBLE_ICONS
					? `Showing ${MAX_VISIBLE_ICONS} of ${matchingNames.length} icons. Search to narrow down.`
					: `${matchingNames.length} icons`}
			</p>
		</div>
	);
}

function filterIconNames(query: string) {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) {
		return iconNames;
	}
	return iconNames.filter((name) => terms.every((term) => name.includes(term)));
}
