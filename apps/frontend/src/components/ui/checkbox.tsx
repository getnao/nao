import * as React from 'react';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
	return (
		<CheckboxPrimitive.Root
			data-slot='checkbox'
			className={cn(
				'peer size-4 shrink-0 rounded-[4px] bg-muted shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] outline-none transition-all dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]',
				'data-[state=checked]:bg-brand-gradient data-[state=checked]:text-background data-[state=checked]:shadow-none dark:data-[state=checked]:shadow-none',
				'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
				'aria-invalid:ring-destructive/20 aria-invalid:ring-[3px] dark:aria-invalid:ring-destructive/40',
				'disabled:cursor-not-allowed disabled:opacity-50',
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot='checkbox-indicator'
				className='flex items-center justify-center text-current'
			>
				<CheckIcon className='size-3' />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
