import { Button } from '@/components/ui/button';

export function EffectiveAccessStatusRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<li className='flex min-h-10 items-center justify-between gap-3 px-3 py-2'>
			<p className={onRetry ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message}</p>
			{onRetry && (
				<Button type='button' size='sm' variant='outline' className='rounded-full' onClick={onRetry}>
					Retry
				</Button>
			)}
		</li>
	);
}
