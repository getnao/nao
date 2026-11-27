import { AlertTriangle, CircleAlert } from 'lucide-react';

import { cn } from '@/lib/cn';

export function Message({ tone, children }: { tone: 'error' | 'warning'; children: string }) {
	const Icon = tone === 'error' ? CircleAlert : AlertTriangle;
	return (
		<div
			role={tone === 'error' ? 'alert' : 'status'}
			className={cn(
				'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
				tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
			)}
		>
			<Icon className='mt-0.5 size-4 shrink-0' />
			<span>{children}</span>
		</div>
	);
}
