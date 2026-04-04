import { cn } from '@/lib/utils';

const FOLDER_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'] as const;

export function FolderColorPicker({
	value,
	onChange,
}: {
	value: string | null;
	onChange: (color: string | null) => void;
}) {
	return (
		<div className='flex items-center gap-1.5'>
			<button
				type='button'
				onClick={() => onChange(null)}
				className={cn(
					'size-5 rounded-full border-2 transition-colors',
					value === null
						? 'border-foreground'
						: 'border-muted-foreground/30 hover:border-muted-foreground/60',
				)}
				aria-label='No color'
			>
				<span className='sr-only'>None</span>
			</button>
			{FOLDER_COLORS.map((color) => (
				<button
					key={color}
					type='button'
					onClick={() => onChange(color)}
					className={cn(
						'size-5 rounded-full border-2 transition-colors',
						value === color ? 'border-foreground' : 'border-transparent hover:border-muted-foreground/60',
					)}
					style={{ backgroundColor: color }}
					aria-label={color}
				/>
			))}
		</div>
	);
}
