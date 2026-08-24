import { AlertTriangle, Info } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type CalloutVariant = 'info' | 'warning' | 'destructive';

interface CalloutProps {
	children: ReactNode;
	variant?: CalloutVariant;
	icon?: ComponentType<{ className?: string }>;
	className?: string;
}

const variantStyles: Record<
	CalloutVariant,
	{ container: string; icon: string; defaultIcon: ComponentType<{ className?: string }> }
> = {
	info: {
		container: 'border-input bg-muted/40 text-muted-foreground',
		icon: 'text-muted-foreground',
		defaultIcon: Info,
	},
	warning: {
		container: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
		icon: 'text-amber-500',
		defaultIcon: AlertTriangle,
	},
	destructive: {
		container: 'border-destructive/20 bg-destructive/10 text-destructive',
		icon: 'text-destructive',
		defaultIcon: AlertTriangle,
	},
};

export function Callout({ children, variant = 'info', icon, className }: CalloutProps) {
	const styles = variantStyles[variant];
	const Icon = icon ?? styles.defaultIcon;
	return (
		<div
			className={cn(
				'flex gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed',
				styles.container,
				className,
			)}
		>
			<Icon className={cn('size-3.5 shrink-0 mt-0.5', styles.icon)} />
			<span>{children}</span>
		</div>
	);
}
