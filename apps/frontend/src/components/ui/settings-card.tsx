import { cn } from '@/lib/utils';

interface SettingsCardProps {
	title?: string;
	badge?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}

export function SettingsCard({ title, badge, children, className }: SettingsCardProps) {
	return (
		<div className={cn('flex flex-col gap-6 p-6 rounded-lg border border-border bg-card', className)}>
			{(title || badge) && (
				<div className='flex items-center justify-between'>
					{title && <h3 className='text-lg font-medium text-foreground'>{title}</h3>}
					{badge}
				</div>
			)}
			{children}
		</div>
	);
}
