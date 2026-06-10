import { Slider } from 'radix-ui';
import type { ToolCallDensity } from '@nao/shared/types';
import { cn } from '@/lib/utils';

const densityOptions: { value: ToolCallDensity; label: string }[] = [
	{ value: 'compact', label: 'Compact' },
	{ value: 'detailed', label: 'Detailed' },
];

export const ToolCallDensitySlider = ({
	value,
	onValueChange,
}: {
	value: ToolCallDensity;
	onValueChange: (value: ToolCallDensity) => void;
}) => {
	const selectedIndex = densityOptions.findIndex((option) => option.value === value);

	return (
		<div className='flex w-44 flex-col gap-1.5'>
			<Slider.Root
				className='relative flex h-4 w-full touch-none select-none items-center'
				value={[selectedIndex]}
				onValueChange={([index]) => onValueChange(densityOptions[index].value)}
				min={0}
				max={densityOptions.length - 1}
				step={1}
				aria-label='Tool call density'
			>
				<Slider.Track className='relative h-1.5 grow rounded-full bg-muted'>
					{densityOptions.map((option, index) => (
						<span
							key={option.value}
							className={cn(
								'absolute top-1/2 size-1 -translate-y-1/2 rounded-full bg-muted-foreground/40',
								index === 0 ? 'left-1.5' : 'right-1.5',
								index === selectedIndex && 'opacity-0',
							)}
						/>
					))}
				</Slider.Track>
				<Slider.Thumb
					className={cn(
						'block size-4 cursor-pointer rounded-full border border-border bg-background shadow-sm transition-colors',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
					)}
				/>
			</Slider.Root>
			<div className='flex justify-between text-xs'>
				{densityOptions.map((option) => (
					<button
						key={option.value}
						type='button'
						onClick={() => onValueChange(option.value)}
						className={cn(
							'cursor-pointer transition-colors hover:text-foreground',
							option.value === value ? 'font-medium text-foreground' : 'text-muted-foreground',
						)}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
};
