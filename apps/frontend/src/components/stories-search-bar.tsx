import { Search, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export function StoriesSearchBar({
	value,
	onChange,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	className?: string;
}) {
	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Escape') {
			onChange('');
		}
	}

	return (
		<div
			className={cn(
				'flex items-center gap-2 rounded-full border px-3 h-8 w-full max-w-sm focus-within:border-foreground/40 transition-colors',
				className,
			)}
		>
			<Search className='size-4 text-muted-foreground shrink-0' />
			<input
				type='text'
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder='Search stories or paste an ID...'
				aria-label='Search stories'
				className='flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
			/>
			{value && (
				<button
					type='button'
					onClick={() => onChange('')}
					aria-label='Clear search'
					className='text-muted-foreground hover:text-foreground shrink-0'
				>
					<X className='size-4' />
				</button>
			)}
		</div>
	);
}
