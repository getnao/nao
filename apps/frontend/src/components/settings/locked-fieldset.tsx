import { cn } from '@/lib/utils';

interface LockedFieldsetProps {
	disabled: boolean;
	children: React.ReactNode;
	className?: string;
}

export function LockedFieldset({ disabled, children, className }: LockedFieldsetProps) {
	return (
		<fieldset
			disabled={disabled}
			className={cn(
				'flex min-w-0 flex-col gap-4 border-0 p-0',
				className,
				disabled && 'pointer-events-none opacity-60',
			)}
			aria-disabled={disabled}
		>
			{children}
		</fieldset>
	);
}
