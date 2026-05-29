import { Spinner } from '@/components/ui/spinner';

export function StoryContentLoading() {
	return (
		<div className='flex flex-1 h-full items-center justify-center p-6 text-muted-foreground'>
			<div className='flex flex-col items-center gap-3'>
				<Spinner />
				<p className='text-sm'>Loading story content...</p>
			</div>
		</div>
	);
}
