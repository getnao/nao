import { cn } from '@/lib/utils';

interface EmptyProps {
	children: React.ReactNode;
	className?: string;
}

export function Empty({ children, className }: EmptyProps) {
	return (
		<div className={cn('text-sm text-muted-foreground text-center p-2 whitespace-pre', className)}>{children}</div>
	);
}
