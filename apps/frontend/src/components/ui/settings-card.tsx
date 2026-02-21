import { cn } from '@/lib/utils';

interface SettingsCardProps {
	icon?: React.ReactNode;
	title?: string;
	titleSize?: 'md' | 'lg';
	description?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
	divide?: boolean;
}

export function SettingsCard({
	icon,
	title,
	titleSize = 'md',
	description,
	action,
	children,
	className,
	divide = false,
}: SettingsCardProps) {
	return (
		<div className={cn('flex flex-col', titleSize === 'lg' && 'gap-5', titleSize === 'md' && 'gap-2.5')}>
			{title && (
				<div className='flex items-center justify-between'>
					<div className='px-4 space-y-0'>
						<div className='px-0 flex items-center gap-2'>
							{icon && <div className='size-4 flex items-center justify-center shrink-0'>{icon}</div>}
							<div className='flex items-center justify-between flex-1'>
								{title && (
									<div
										className={cn(
											'font-semibold text-foreground',
											titleSize === 'lg' && 'text-xl',
											titleSize === 'md' && 'text-base',
										)}
									>
										{title}
									</div>
								)}
							</div>
						</div>
						{description && (
							<p
								className={cn(
									'text-muted-foreground',
									titleSize === 'lg' && 'text-sm',
									titleSize === 'md' && 'text-xs',
								)}
							>
								{description}
							</p>
						)}
					</div>
					{action && <div className='ml-auto'>{action}</div>}
				</div>
			)}

			<div
				className={cn(
					'flex flex-col gap-4 p-4 rounded-xl border border-border bg-card',
					divide && 'gap-2 divide-y divide-border *:not-last:pb-2',
					className,
				)}
			>
				{children}
			</div>
		</div>
	);
}
