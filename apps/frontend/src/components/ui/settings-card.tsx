import { cn } from '@/lib/utils';

interface SettingsCardProps {
	icon?: React.ReactNode;
	title?: string;
	badge?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}

export function SettingsCard({ icon, title, badge, children, className }: SettingsCardProps) {
	return (
		<div className={cn('flex flex-col gap-2', className)}>
			<div className='flex flex-col gap-3 p-4 rounded-xl border border-border bg-card'>
				{(title || badge) && (
					<div className='px-0 flex items-center gap-2'>
						{icon && <div className='size-4 flex items-center justify-center shrink-0'>{icon}</div>}
						<div className='flex items-center justify-between flex-1'>
							{title && <div className='text-md font-medium text-foreground'>{title}</div>}
							{badge}
						</div>
					</div>
				)}

				{children}
			</div>
		</div>
	);
}
