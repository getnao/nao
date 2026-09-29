import { cn } from '@/lib/utils';

export function SettingsPageWrapper({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
	return (
		<div className='overflow-auto flex-1 bg-background [scrollbar-gutter:stable]'>
			<div
				className={cn(
					'flex flex-col w-full px-4 py-6 md:p-8 mx-auto min-h-full',
					wide ? 'w-full gap-6' : 'max-w-4xl gap-8 md:gap-12',
				)}
			>
				{children}
			</div>
		</div>
	);
}

interface SettingsCardProps {
	icon?: React.ReactNode;
	title?: string;
	titleSize?: 'md' | 'lg';
	description?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	rootClassName?: string;
	className?: string;
	divide?: boolean;
	flush?: boolean;
	unstyled?: boolean;
}

export function SettingsCard({
	icon,
	title,
	titleSize = 'md',
	description,
	action,
	children,
	rootClassName,
	className,
	divide = false,
	flush = false,
	unstyled = false,
}: SettingsCardProps) {
	return (
		<div
			className={cn(
				'flex flex-col',
				titleSize === 'lg' && 'gap-5',
				titleSize === 'md' && 'gap-2.5',
				rootClassName,
			)}
		>
			{(title || action) && (
				<div className='flex items-center justify-between'>
					<div className='space-y-0'>
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
					'flex flex-col gap-4',
					!unstyled && 'p-4 rounded-xl border border-border bg-background',
					flush && 'overflow-hidden [&_th]:px-4 [&_td]:px-4',
					!unstyled && flush && 'p-0',
					divide && 'gap-2 divide-y divide-border *:not-last:pb-2',
					className,
				)}
			>
				{children}
			</div>
		</div>
	);
}
