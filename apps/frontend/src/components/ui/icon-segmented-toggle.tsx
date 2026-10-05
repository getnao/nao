import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface IconSegmentedToggleOption<Value extends string> {
	value: Value;
	label: string;
	icon: LucideIcon;
}

interface IconSegmentedToggleProps<Value extends string> {
	options: readonly IconSegmentedToggleOption<Value>[];
	value: Value;
	onValueChange: (value: Value) => void;
	disabled?: boolean;
	className?: string;
}

export function IconSegmentedToggle<Value extends string>({
	options,
	value,
	onValueChange,
	disabled = false,
	className,
}: IconSegmentedToggleProps<Value>) {
	return (
		<div className={cn('flex items-center gap-1.5 rounded-full border p-0.5', className)}>
			{options.map(({ value: option, label, icon: Icon }) => (
				<SimpleTooltip key={option} content={label}>
					<Button
						type='button'
						variant='ghost'
						className={cn(
							'size-5.5 px-2',
							value === option && 'bg-accent rounded-full',
							'hover:rounded-full',
						)}
						onClick={() => onValueChange(option)}
						disabled={disabled}
						aria-label={label}
						aria-pressed={value === option}
					>
						<Icon className='size-3' strokeWidth={2.25} />
					</Button>
				</SimpleTooltip>
			))}
		</div>
	);
}
