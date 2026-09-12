import { cn } from '@/lib/utils';

export function UserGroupContextModeSelector({
	mode,
	everythingDescription,
	specificDescription,
	onEverything,
	onSpecific,
}: {
	mode: 'all' | 'restricted';
	everythingDescription: string;
	specificDescription: string;
	onEverything: () => void;
	onSpecific: () => void;
}) {
	return (
		<div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
			<ModeButton
				title='Everything'
				description={everythingDescription}
				selected={mode === 'all'}
				onClick={onEverything}
			/>
			<ModeButton
				title='Specific selection'
				description={specificDescription}
				selected={mode === 'restricted'}
				onClick={onSpecific}
			/>
		</div>
	);
}

function ModeButton({
	title,
	description,
	selected,
	onClick,
}: {
	title: string;
	description: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				'min-h-16 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
				selected && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
			)}
		>
			<span className='block text-sm font-medium'>{title}</span>
			<span className={cn('block text-xs text-muted-foreground', selected && 'text-primary/80')}>
				{description}
			</span>
		</button>
	);
}
