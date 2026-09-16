import { cn } from '@/lib/utils';

interface LockedFieldsetProps {
	disabled: boolean;
	children: React.ReactNode;
}

export function LockedFieldset({ disabled, children }: LockedFieldsetProps) {
	return (
		<fieldset
			disabled={disabled}
			className={cn('flex min-w-0 flex-col gap-4 border-0 p-0', disabled && 'pointer-events-none opacity-60')}
			aria-disabled={disabled}
		>
			{children}
		</fieldset>
	);
}
