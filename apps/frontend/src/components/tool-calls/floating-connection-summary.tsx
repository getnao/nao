import { ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { requestWarehouseCredentials } from '@nao/shared/tools';

import { Button } from '@/components/ui/button';
import { DatabaseIcon } from '@/components/ui/database-icon';
import { cn } from '@/lib/utils';

interface FloatingConnectionSummaryProps {
	provider: requestWarehouseCredentials.Provider;
	title: string;
	detail: string;
	tone: 'neutral' | 'error';
	action?: ReactNode;
	onShow: () => void;
}

export function FloatingConnectionSummary({
	provider,
	title,
	detail,
	tone,
	action,
	onShow,
}: FloatingConnectionSummaryProps) {
	return (
		<div
			role='status'
			aria-label={title}
			className={cn(
				'animate-fade-in-up flex items-center gap-3 rounded-xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur',
				tone === 'error' ? 'border-destructive/25' : 'border-violet/20',
			)}
		>
			<DatabaseIcon dialect={provider} className='size-4 shrink-0' />
			<div className='flex min-w-0 flex-1 flex-col'>
				<span className='truncate text-sm font-medium'>{title}</span>
				<span
					className={cn('truncate text-xs', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
				>
					{detail}
				</span>
			</div>
			{action}
			<Button variant='ghost' size='sm' className='h-7 shrink-0 rounded-full px-2.5 text-xs' onClick={onShow}>
				<ArrowUp className='size-3' />
				View
			</Button>
		</div>
	);
}
