import * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id }: SwitchProps) {
	return (
		<button
			id={id}
			type='button'
			role='switch'
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onCheckedChange(!checked)}
			className={cn(
				'relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full px-0.5 bg-muted',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
				'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]',
				'disabled:cursor-not-allowed disabled:opacity-50',
			)}
		>
			<span
				aria-hidden='true'
				className={cn(
					'pointer-events-none absolute inset-0 rounded-full bg-brand-gradient transition-opacity',
					checked ? 'opacity-100' : 'opacity-0',
				)}
			/>
			<span
				className={cn(
					'pointer-events-none relative block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
					checked ? 'translate-x-3' : 'translate-x-0',
				)}
			/>
		</button>
	);
}
