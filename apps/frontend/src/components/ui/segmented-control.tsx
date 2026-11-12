import { cn } from '@/lib/utils';

export interface SegmentedControlOption<Value extends string> {
	value: Value;
	label: string;
}

/**
 * Rounded buttons picking one option, whose highlight slides to the picked one. Every segment takes the width of the
 * widest, so the highlight moves by whole segments without measuring them.
 */
export function SegmentedControl<Value extends string>({
	label,
	options,
	value,
	onChange,
	className,
}: {
	label: string;
	options: readonly SegmentedControlOption<Value>[];
	value: Value;
	onChange: (value: Value) => void;
	className?: string;
}) {
	const selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);

	return (
		<div
			role='group'
			aria-label={label}
			className={cn('relative grid shrink-0 auto-cols-fr grid-flow-col', className)}
		>
			<span
				aria-hidden='true'
				className='absolute inset-y-0 left-0 rounded-full bg-muted motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out'
				style={{ width: `${100 / options.length}%`, transform: `translateX(${selectedIndex * 100}%)` }}
			/>
			{options.map((option) => (
				<button
					key={option.value}
					type='button'
					aria-pressed={option.value === value}
					onClick={() => onChange(option.value)}
					className={cn(
						'relative h-6 cursor-pointer rounded-full px-2.5 text-[11px] font-medium transition-colors',
						option.value === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
